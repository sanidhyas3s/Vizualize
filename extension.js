const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function getBreakpoints() {
	const activeFilePath = vscode.window.activeTextEditor.document.uri.fsPath;
	const breakpoints = vscode.debug.breakpoints;
	const lineNumbers = [];
	for (const breakpoint of breakpoints) {
		const breakpointLocation = breakpoint['location'];
		if (breakpointLocation && breakpointLocation.uri.fsPath === activeFilePath) {
			lineNumbers.push(breakpointLocation.range.start.line + 1);
		}
	}

	return [lineNumbers[0], lineNumbers[lineNumbers.length - 1]];
}

async function compileActiveFile(context, activeEditor, terminal) {
	let filePath = activeEditor.document.uri.fsPath;
	let fileName = path.parse(path.basename(filePath)).name;
	let destinationFilePath = `${context.extensionPath}/user_compiled/${fileName}`;
	terminal.sendText(`g++ -g "${filePath}" -o "${destinationFilePath}"`);
	// terminal.dispose();
	return destinationFilePath;
}

async function createDebugLogs(context, userCompiledPath, inputPath, terminal) {
	if (inputPath) {
		terminal.sendText(`gdb "${userCompiledPath}" -ex 'run < ${inputPath}' -ex 'source gdb_command.txt' -batch -ex 'c' -ex 'y' -ex 'q' -ex 'y'`);
	}
	else {
		terminal.sendText(`gdb "${userCompiledPath}" -ex 'source gdb_command.txt' -batch -ex 'c' -ex 'y' -ex 'q' -ex 'y'`);
	}
	//terminal.dispose();
	//currently not able to kill the terminal because it takes some time for the above command to logFileish and we can't kill the terminal before it logFileishes.
	return `${context.extensionPath}/user_compiled/debug_logs.txt`;
}

function readDebugLogs(logfile, breakpoints, variablesWanted) {
	function parseString(s, index, check, n) {
		let t = "";
		while (index < n && s[index] !== check) {
			t += s[index];
			index++;
		}
		return [t, index];
	}

	function parseSpecialString(s, ind, n) {
		let t = "";
		while (ind < n && s[ind] >= '0' && s[ind] <= '9') {
			t += s[ind];
			ind++;
		}
		return [t, ind];
	}

	const arrayIterators = new Map();
	const variables = new Map();
	for (let variable of variablesWanted) {
		variables.set(variable.name, variable.type);
		if (variable.type === "int array" || variable.type === "string array") {
			arrayIterators.set(variable.name, variable.iterators);
		}
	}


	let logFile = fs.readFileSync(logfile, 'utf-8').split('\n');
	let logLine;
	let isParsingStarted = false;
	let startingBreakpoint = breakpoints[0];
	let endingBreakpoint = breakpoints[1];
	let variableValuesArray = [];
	let currentLineOfExecution;
	let tempVariableValuesArray = [];
	let isVariableValueUpdated = false;

	for (let i = 0; i < logFile.length; i++) {
		logLine = logFile[i];
		let currentLineLength = logLine.length;
		let temp = parseSpecialString(logLine, 0, currentLineLength);
		if (temp[0] === endingBreakpoint) {
			break;
		}
		if (temp[0] === startingBreakpoint) {
			isParsingStarted = true;
		}
		if (isParsingStarted) {
			if (logLine[0] > '0' && logLine[0] <= '9') {
				if (isVariableValueUpdated) {
					variableValuesArray.push([currentLineOfExecution, tempVariableValuesArray]);
					tempVariableValuesArray = [];
				}
				currentLineOfExecution = logLine;
				isVariableValueUpdated = true;
			}
			else {
				temp = parseString(logLine, 0, ' ', currentLineLength);
				if (variables.has(temp[0])) {
					let tempVar = variables.get(temp[0]);
					let value = parseString(logLine, 0, '=', currentLineLength);
					if (tempVar === "int") {
						let index = value[1] + 2;
						let x = parseString(logLine, index, ' ', currentLineLength);
						tempVariableValuesArray.push([temp[0], parseInt(x[0])]);
					}
					else if (tempVar === "int array") {
						let index = value[1] + 3;
						if (logLine[index - 1] !== '{') {
							index = parseString(logLine, index, '=', currentLineLength)[1];
							index += 2;
						}
						let x = parseString(logLine, index, '}', currentLineLength);
						tempVariableValuesArray.push([temp[0], x[0].split(/,\s*/)]);
					}
					else if (tempVar === "string") {
						let index = value[1] + 3;
						let x = parseString(logLine, index, '"', currentLineLength);
						tempVariableValuesArray.push([temp[0], x[0]]);
					}
					else if (tempVar === "string array") {
						let index = value[1] + 3;
						if (logLine[index - 1] !== '{') {
							index = parseString(logLine, index, '=', currentLineLength)[1];
							index += 3;
						}
						let x = parseString(logLine, index, '}', currentLineLength);
						let arr = x[0].substring(1, x[0].length - 1).split(/",\s*"/);
						tempVariableValuesArray.push([temp[0], arr]);
					}
				}
			}
		}
	}
	variableValuesArray.push([currentLineOfExecution, tempVariableValuesArray]);

	let states = [];
	for (let frame of variableValuesArray) {
		let state = { line: frame[0] };
		let vars = [];
		for (let v of frame[1]) {
			let vinsert = { name: v[0] };
			vinsert.type = variables.get(v[0]);
			vinsert.value = v[1];
			if (vinsert.type === 'int array' || vinsert.type === "string array") {
				vinsert.iterators = [];
				for (let i of arrayIterators.get(vinsert.name)) {
					for (let temp of frame[1]) {
						if (i === temp[0]) {
							vinsert.iterators.push(temp[1]);
						}
					}
				}
			}
			vars.push(vinsert);
		}
		state.vars = vars;
		states.push(state);
	}

	return states;
}

async function selectFile() {
	const selection = await vscode.window.showQuickPick(['Select Input File', 'Skip Input File'], { placeHolder: 'Do you want to select an input file?' });
	if (selection === 'Select Input File') {
		let options = {
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			openLabel: 'Select Input File'
		};

		let fileUri = await vscode.window.showOpenDialog(options);
		if (fileUri && fileUri.length > 0) {
			return fileUri[0].fsPath;
		}
	}
	return null;
}


function activate(context) {
	let disposable = vscode.commands.registerCommand('vizualize.animate', async () => {
		let activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			vscode.window.showErrorMessage("No active editor.");
			return;
		}
		if (activeEditor.document.languageId !== "cpp") {
			vscode.window.showErrorMessage("Only C++ files are supported to be vizualized.");
			return;
		}
		let terminalOptions = {
			name: `Terminal for Debug Logs`,
			cwd: context.extensionPath
		};
		let terminal = vscode.window.createTerminal(terminalOptions);
		const breakpoints = getBreakpoints();
		const userCompiledPath = await compileActiveFile(context, activeEditor, terminal);
		const inputPath = await selectFile();
		const debugLogsPath = await createDebugLogs(context, userCompiledPath, inputPath, terminal);
		// IMPORTANT
		// sleep(something) I
		// terminal.dispose();
		let dataWanted = [
			{ name: 'a', type: 'int array', iterators: ['i'] },//to be added: start: 'lo', end: 'hi'
			{ name: 'i', type: 'int' },
			{ name: 'n', type: 'int' }
		];
		let statesToAnimate = readDebugLogs(debugLogsPath, ["8", "15"], dataWanted);
		// console.log(statesToAnimate);

		let panel = vscode.window.createWebviewPanel(
			'vizualize',
			'Vizualize',
			vscode.ViewColumn.Two,
			{ enableScripts: true }
		);
		const cssPath = `${context.extensionPath}/webview/styles.css`;
		panel.webview.html = getWebviewContent(cssPath);
		panel.webview.postMessage(statesToAnimate);

		panel.onDidDispose(
			() => {
				panel = undefined;
				terminal.dispose();
			},
			undefined,
			context.subscriptions
		);
		
		//add a speed controller maybe
		//give a recompile button?
		//insert a onDidDispose - to remove exceptions - DONE
		//remaining - get input name of array
		//move functions into separate files
	});
	context.subscriptions.push(disposable);
}

function getWebviewContent(cssPath) {
	const css = fs.readFileSync(cssPath, 'utf8');
	return `<!DOCTYPE html>
	<html>
	
	<head>
		<title>Animated Array</title>
		<style>
			${css}
		</style>
		<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.3/css/all.min.css" />
	</head>
	
	<body>
		<div id="container"></div>
		<input type="range" id="scroller" min="0" max="100" value="0" step="0.1" />
		<br>
		<div class="buttons">
			<button id="play-pause-button"><i class="fas fa-play"></i></button>
			<button id="restart-button"><i class="fas fa-redo"></i></button>
		</div>
		<script>
			let states;
			let paused = true;
			let currentIndex = 0;
			let timerId;

			const container = document.getElementById("container");
			const scroller = document.getElementById("scroller");
			const playPauseButton = document.getElementById("play-pause-button");
			const restartButton = document.getElementById("restart-button");
	
			window.addEventListener('message', event => {
				//set and animate the data received
				states = event.data;
				displayState(0);
			});
	
			function displayState(stateIndex) {
				container.innerHTML = "";
				const state = states[stateIndex];
	
				const lineContainer = document.createElement("div");
				lineContainer.innerText = state.line;
				lineContainer.classList.add("line-container");
				container.appendChild(lineContainer);
				for (let varr of state.vars) {
					if (varr.type === 'int array' || varr.type === 'string array') {
						const varrContainer = document.createElement("div");
						varrContainer.classList.add("varr-container");
	
						const label = document.createElement("div");
						label.innerText = varr.name + " : ";
						label.classList.add("varr-label");
	
						varrContainer.appendChild(label);
	
						const boxContainer = document.createElement("div");
						boxContainer.style.display = "inline-block";
						for (let i = 0; i < varr.value.length; i++) {
							const box = document.createElement("div");
							box.classList.add("box");
							if (varr.iterators.includes(i)) {
								box.classList.add("highlighted");
							}
							box.innerText = varr.value[i];
							box.style.display = "inline-block";
							boxContainer.appendChild(box);
						}
						varrContainer.appendChild(boxContainer); // add box elements to container
	
						container.appendChild(varrContainer);
					}
				}
				for (let varr of state.vars) {
					if (varr.type === 'int' || varr.type === 'string') {
						const varContainer = document.createElement("div");
						varContainer.classList.add("var-container");
	
						const label = document.createElement("div");
						label.innerText = varr.name + " : ";
						label.classList.add("varr-label");
	
						const value = document.createElement("div");
						value.innerText = varr.value;
						value.classList.add("varr-value");
	
						varContainer.appendChild(label);
						varContainer.appendChild(value);
	
						container.appendChild(varContainer);
					}
				}
				updateScroller();
			}
	
			function updateScroller() {
				scroller.value = 100 * currentIndex / (states.length - 1);
			}
	
			function play() {
				playPauseButton.innerHTML = '<i class="fas fa-pause"></i>';
				timerId = setInterval(() => {
					displayState(currentIndex);
					currentIndex++;
					if (currentIndex >= states.length) {
						clearInterval(timerId);
						currentIndex = 0;
						playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
						paused = true;
					}
				}, 500);
			}
	
			function pause() {
				playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
				clearInterval(timerId);
			}
	
			function restart() {
				currentIndex = 0;
				displayState(0);
			}
	
			playPauseButton.addEventListener("click", () => {
				if (paused) {
					paused = false;
					play();
				} else {
					paused = true;
					pause();
				}
			});
	
			scroller.addEventListener("change", () => {
				currentIndex = Math.floor((states.length - 1) * scroller.value / 100);
				displayState(currentIndex);
			});
	
			restartButton.addEventListener("click", restart);
	
		</script>
	</body>
	
	</html>`;
}

function deactivate() { }

module.exports = {
	activate,
	deactivate
}

deactivate()