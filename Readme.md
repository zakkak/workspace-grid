# Workspace Grid GNOME Shell Extension

This extension extends the [Frippery Static Workspaces extension](https://extensions.gnome.org/extension/12/static-workspaces/) by:

* holding the number of workspaces fixed (Frippery Static Workspaces)
* allowing the user to specify their workspace layout (rows/columns)
* updating the workspaces display in the overview to reflect the workspace grid layout
* updating the workspace switcher/keybindings to reflect the workspace grid layout
* (optionally) adding a visual workspace indicator. (TODO: separate extension?)

TODO: 
Screenshot of the extension.

Note - if you do not want the workspace thumbnail preview in the overview, use the [Remove Workspaces Sidebar extension](https://extensions.gnome.org/extension/387/remove-workspaces-sidebar/).

### Known Issues
* If you have many horizontal workspaces, the workspace display in the overview will be wider than the screen.

Written 2012 by mathematical.coffee [mathematical.coffee@gmail.com](mailto:mathematical.coffee@gmail.com?subject=workspace-grid%20question).   
Project webpage: [at  bitbucket](https://bitbucket.org/mathematicalcoffee/workspace-grid-gnome-shell-extension).

---

# Installation

1. Download the .zip file on the [Downloads page](https://bitbucket.org/mathematicalcoffee/workspace-grid-gnome-shell-extension/downloads).
2. Open `gnome-tweak-tool`, go to "Shell Extensions", "Install Extension" and select the .zip file.

---

# For Developers:

* If there is a 'stable' branch, it is meant to be stable at any commit, and should be compatible with both GNOME 3.2 and 3.4 (meaning: configuration occurs via editting `extension.js`, and possible polyglot statements to import extension files).
* If there is a 'gnome3.2' branch, it is *only* compatible with gnome 3.2 (e.g. extension imports are done in the gnome 3.2 fashion, or we use functions depreciated in 3.4, ...)
* If there is a 'gnome3.4' branch, it is *only* compatible with gnome 3.4 (extension imports, defining classes with `Lang.Class`, perhaps a `prefs.js` and `convenience.js`, ...)
* The 'default' branch is not guaranteed to be stable at any commit, and is where development occurs.
