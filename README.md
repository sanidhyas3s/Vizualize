# **Vizualize**

Contributions to Vizualize are welcome! If you find a bug, have a feature request, or want to contribute code, please submit an issue or pull request on the project's GitHub page.

### **Requirements**
- Visual Studio Code (obviously)
- `g++` - A stable compliant version of the `g++` compiler
- `gdb` - GNU Debugger (Recommended Version 12.1 or newer)

Check whether your system has the above requirements with the following commands, they should return their version info if available else some error about the inavailability of the specified requirements:
- `code --version`
- `g++ --version`
- `gdb --version`


### Steps to activate the extension using the source code

- Download the source code from GitHub or clone [the repository](https://github.com/sanidhyas3s/Vizualize) using `git clone`.
- Open the project directory in VS Code either through the GUI or through the terminal using the command `code vizualize` from the parent directory of the project directory(vizualize).
- Run the extension through the option `Debug: Start Debugging` from the command prompt (`Ctrl` + `Shift` + `P`) or alternatively using the keyboard shortcut "`F5`" for the same.
- Now, in the `Extension Development Host` environment, you would have our extension activated. The extension would not be enabled globally in VS Code through this method.

It should be noted that the `node_modules` folder is included in the repository, as it is a relatively lightweight component of our project. However, should you choose not to download this folder, you can run the command `npm i` to install it.

### **Contributing**

Contributions to the project are absolutely welcome. If you find a bug, have a feature request, or want to contribute code, please submit an issue or pull request on the [project's GitHub page](https://github.com/sanidhyas3s/Vizualize).

No one writes perfect code, like we help you find bugs in your code, you can also find bugs in ours!
