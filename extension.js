const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

async function getBreakpoints(activeEditor) {
	const activeFilePath = activeEditor.document.uri.fsPath;
	let breakpoints = vscode.debug.breakpoints;
	let lineNumbers = [];

	while (!lineNumbers.length) {
		for (const breakpoint of breakpoints) {
			const breakpointLocation = breakpoint['location'];
			if (breakpointLocation && breakpointLocation.uri.fsPath === activeFilePath) {
				lineNumbers.push(breakpointLocation.range.start.line + 1);
			}
		}

		if (!lineNumbers.length) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			vscode.debug.onDidChangeBreakpoints(() => { breakpoints = vscode.debug.breakpoints });
		}
	}
	return [Math.min(...lineNumbers).toString(), Math.max(...lineNumbers).toString()];
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
							index += 3;
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
			matchOnDetail: true,
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

async function addVariable(dataWanted) {
	const variableTypes = [
		{ label: 'Numerical Array (or equivalent)', value: 'int array' },
		{ label: 'String Array (or equivalent)', value: 'string array' },
		{ label: 'Iterator to an Array', value: 'iter' },
		{ label: 'Numerical Variable', value: 'int' },
		{ label: 'String Variable', value: 'string' }
	]
	const selection = await vscode.window.showQuickPick(
		variableTypes,
		{ placeHolder: 'Select the type of variable to add to the vizualization:' }
	);
	if (selection.value === 'iter') {
		let arrayNames = dataWanted.filter(item => item.type === 'int array' || item.type === 'string array').map(item => item.name);
		const arrayName = await vscode.window.showQuickPick(
			arrayNames,
			{ placeHolder: 'Select the array to which you want to add the iterator:' }
		);
		const iterator = await vscode.window.showInputBox({
			prompt: 'Enter iterator\'s variable name:',
			placeHolder: 'Iterator\'s Name'
		});
		dataWanted.push({ name: iterator, type: 'int' })
		for (let element of dataWanted) {
			if (element.name === arrayName) {
				element.iterators.push(iterator);
			}
		}
		return dataWanted;
	}
	const userInput = await vscode.window.showInputBox({
		prompt: 'Enter variable name:',
		placeHolder: 'Variable Name'
	});
	if (selection.value === 'int array' || selection.value === 'string array') {
		dataWanted.push({ name: userInput, type: selection.value, iterators: [] });
		return dataWanted;
	}
	dataWanted.push({ name: userInput, type: selection.value });
	return dataWanted;
}

function activate(context) {
	let disposable = vscode.commands.registerCommand('vizualize.animate', async () => {
		const config = vscode.workspace.getConfiguration();
		const speed = config.get('vizualize.speed');
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
		let breakpoints = await getBreakpoints(activeEditor);
		let userCompiledPath = await compileActiveFile(context, activeEditor, terminal);
		let inputPath = await selectFile();
		let debugLogsPath = await createDebugLogs(context, userCompiledPath, inputPath, terminal);
		let dataWanted = [];
		let statesToAnimate;
		dataWanted = await addVariable(dataWanted);
		console.log(dataWanted);
		statesToAnimate = readDebugLogs(debugLogsPath, breakpoints, dataWanted);

		let panel = vscode.window.createWebviewPanel(
			'vizualize',
			'Vizualize',
			vscode.ViewColumn.Two,
			{ enableScripts: true }
		);
		const cssPath = `${context.extensionPath}/webview/styles.css`;
		panel.webview.html = getWebviewContent(cssPath, speed);
		panel.webview.postMessage(statesToAnimate);

		panel.webview.onDidReceiveMessage(
			async message => {
				if (message.command === 'addVariable') {
					dataWanted = await addVariable(dataWanted);
					statesToAnimate = readDebugLogs(debugLogsPath, breakpoints, dataWanted);
					panel.webview.postMessage(statesToAnimate);
				}
				if (message.command === 'recompile') {
					userCompiledPath = await compileActiveFile(context, activeEditor, terminal);

					setTimeout(async () => {
						debugLogsPath = await createDebugLogs(context, userCompiledPath, inputPath, terminal);
						breakpoints = await getBreakpoints(activeEditor);
						setTimeout(() => {
							statesToAnimate = readDebugLogs(debugLogsPath, breakpoints, dataWanted);
							panel.webview.postMessage(statesToAnimate);
						}, 1000);
					}, 1000);

				}
			},
			undefined,
			context.subscriptions
		);

		panel.onDidDispose(
			() => {
				panel = undefined;
				terminal.sendText(`rm ${userCompiledPath}`);
				terminal.sendText(`clear`);
				setTimeout(() => { terminal.dispose(); }, 1000)
			},
			undefined,
			context.subscriptions
		);
	});
	context.subscriptions.push(disposable);
}

function getWebviewContent(cssPath, speed) {
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
			<button id="play-pause-button" title="Play/Pause Vizualization"><i class="fas fa-play"></i></button>
			<button id="restart-button" title="Restart Vizualization"><i class="fas fa-redo"></i></button>
		</div>
		<div class="buttons">
			<button id="plus-button" title="Add Variable"><i class="fas fa-plus"></i></button>
			<button id="recompile-button" title="Recompile Code"><i class="fa fa-file-code"></i></button>
		</div>
		<script>
			const vscode = acquireVsCodeApi();

			let states;
			let paused = true;
			let currentIndex = 0;
			let timerId;
			let speed = ${speed};

			const container = document.getElementById("container");
			const scroller = document.getElementById("scroller");
			const playPauseButton = document.getElementById("play-pause-button");
			const restartButton = document.getElementById("restart-button");
			const addVarButton = document.getElementById("plus-button");
			const recompileButton = document.getElementById("recompile-button");
	
			window.addEventListener('message', event => {
				//set and animate the data received
				states = event.data;
				displayState(currentIndex);
			});
			
			addVarButton.addEventListener("click", () => {
				vscode.postMessage({ command: 'addVariable' });
			});

			recompileButton.addEventListener("click", () => {
				vscode.postMessage({ command: 'recompile' });
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
				updateScroller(stateIndex);
			}
	
			function updateScroller(Index) {
				scroller.value = 100 * Index / (states.length - 1);
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
				}, speed);
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

deactivate();