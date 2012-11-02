# Workspace Grid GNOME Shell Extension

This extension allows you to configure your workspaces in a grid.
Inspired by the [Frippery Static Workspaces extension](https://extensions.gnome.org/extension/12/static-workspaces/).
This is what it does:

* holding the number of workspaces fixed (Frippery Static Workspaces)
* allowing the user to specify their workspace layout (rows/columns)
* updating the workspaces display in the overview to reflect the workspace grid layout
* updating the workspace switcher/keybindings to reflect the workspace grid layout

Note - if you use a bottom panel, [Frippery Bottom Panel](https://extensions.gnome.org/extension/3/bottom-panel/) **already has** workspace grid functionality (I didn't realise until I finished writing this extension)!

| Workspace switcher/keybindings | Workspace thumbnails in Overview |
|:-----:|:-----:|
| ![Workspace switcher](http://cdn.bitbucket.org/mathematicalcoffee/workspace-grid-gnome-shell-extension/downloads/workspace-switcher.png) | ![Workspace thumbnails](http://cdn.bitbucket.org/mathematicalcoffee/workspace-grid-gnome-shell-extension/downloads/workspace-thumbnails.png) |

Written 2012 by mathematical.coffee [mathematical.coffee@gmail.com](mailto:mathematical.coffee@gmail.com?subject=workspace-grid%20question).   
Project webpage: [at bitbucket](https://bitbucket.org/mathematicalcoffee/workspace-grid-gnome-shell-extension).  
Report bugs: [on the Issues page at bitbucket](https://bitbucket.org/mathematicalcoffee/workspace-grid-gnome-shell-extension/issues).


## Other relevant extensions
Combine these extensions with this one or just use these if this doesn't do what you want:

If you use a bottom panel, [Frippery Bottom Panel](https://extensions.gnome.org/extension/3/bottom-panel/) *already has* workspace grid functionality (I didn't realise until I finished writing this extension)!

If you just want static workspaces and none of this grid stuff, use the [Frippery Static Workspaces extension](https://extensions.gnome.org/extension/12/static-workspaces/).

If you do not want the workspace thumbnail preview in the overview, use the [Remove Workspaces Sidebar extension](https://extensions.gnome.org/extension/387/remove-workspaces-sidebar/).

If you want a textual workspace indicator in your panel, use the [Workspace Indicator extension](https://extensions.gnome.org/extension/21/workspace-indicator/).

If you want to use arrow keys to navigate between workspaces in the overview, use the [Workspace navigator extension](https://extensions.gnome.org/extension/29/workspace-navigator/).

If you want a graphical workspace indicator/switcher in your panel (like GNOME-panel's workspace switcher, but without the window previews), see the [WorkspaceBar extension](https://extensions.gnome.org/extension/464/workspacebar/). (I am working on a version with the window icons and such but it's still in progress).

Let me know of similar extensions to add to this list.

---

# Installation

Hopefully, this will make it onto extensions.gnome.org.

Otherwise:

1. Download the .zip file on the [Downloads page](https://bitbucket.org/mathematicalcoffee/workspace-grid-gnome-shell-extension/downloads).
2. Open `gnome-tweak-tool`, go to "Shell Extensions", "Install Extension" and select the .zip file.

# Configuration

On GNOME 3.2: edit `extension.js` and restart.  
On GNOME 3.4: use `gnome-shell-extension-prefs`.

Things that can be configured (along with code snippet for GNOME 3.2 people):

### Number of rows/columns in the workspace.
Snippet in `extension.js` (up the top):

    const WORKSPACE_CONFIGURATION = {
        rows: 2,     // <-- enter the number of rows you want
        columns: 3   // <-- enter the number of columns you want
    };

### Whether workspaces wrap around.
When navigating workspaces (via keybindings, scrolling over the workspace thumbnails in the Overview) do you want to wrap around from the start to the end (e.g. going past workspace `n` wraps back to workspace 1)?

    const WRAPAROUND = true;

### Workspaces thumbnails sidebar in overview.
This sidebar can get pretty wide if you have multiple columns of workspaces.
The sidebar can be collapse to the side of the screen if it becomes too wide so that you then hover your mouse over it to uncollapse it.

The relevant settings:

* the maximum width the sidebar is allowed to occupy (as a fraction of screen width):

        const MAX_SCREEN_HFRACTION = 0.8;

* the width at which the sidebar collapses to the side when you open the overview (fraction of screen width):

        const MAX_SCREEN_HFRACTION_BEFORE_COLLAPSE = 0.3;

---

# For developers wanting to integrate with this extension

If you wish to see if your extension is compatible with this one, these are things you need to know.

## Exported stuff

This extension exports a number of constants and functions to an object `global.screen.workspace_grid` for your convenience.
(It isn't particularly good code style as this "breaks the extension barrier" so to speak - extensions are meant to be standalone and modular, but when multiple extensions have overlapping functionalities it makes sense to use another extension's functionality rather than re-implement it in your own).

Note that the Workspace Grid extension must be enabled for this all to work.
The `global.screen.workspace_grid` object contains:

(Exported Constants)

* `Directions` = `{ UP, LEFT, RIGHT, DOWN }` : directions for navigating (see `moveWorkspaces` further down) (**NOTE**: From 3.6+ just use `Meta.MotionDirection.{UP, LEFT, RIGHT, DOWN}`)
* `rows`     : number of rows of workspaces
* `columns`  : number of columns of workspaces

(Exported Functions)

* `moveWorkspace` : switches workspaces in the direction specified, being either (`Directions.`)`UP`, `LEFT`, `RIGHT` or `DOWN` (see `Directions`).
* `rowColToIndex` : converts the row/column into an index for use with (e.g.) `global.screen.get_workspace_by_index(i)`
* indexToRowCol : converts an index (`0 to global.screen.n_workspaces-1`) to a row and column
* calculateWorkspace : calculates the index of the workspace adjacent in the specified direction to the current one.
* getWorkspaceSwitcherPopup : retrieves our workspace switcher popup.


For example, to move to the workspace below us:

    const WorkspaceGrid = global.screen.workspace_grid;
    WorkspaceGrid.moveWorkspace(WorkspaceGrid.Directions.DOWN);

I am happy to try help/give an opinion/improve this extension to try make it
 more compatible with yours, email me :)

## Listening to Workspace Grid
Say you want to know the number of rows/columns of workspaces in your
extension. Then you have to wait for this extension to load and populate
`global.screen.workspace_grid`.

When the Workspace Grid extension enables or disables it fires a
 `'notify::n_workspaces'` signal on global.screen.
You can connect to this and check for the existence (or removal) of
`global.screen.workspace_grid`.

e.g.:

    let ID = global.screen.connect('notify::n-workspaces', function () {
        if (global.screen.workspace_grid) {
            // then we can use workspace_grid.rows, cols, etc
        } else {
            // remember, your extension should be able to handle this one being
            // switched on and off! If workspace_grid is no longer here then
            // your code should stop using it.
        }
    });

## Further notes
Workspaces can be changed by the user by a number of ways, and the ways this
extension overrides are:

* keybindings (`Main.wm.setKeybindingHandler` (GNOME 3.2), `Meta.keybindings_set_custom_handler` (GNOME 3.4)),
* keybinding with global grab in progress (e.g. in Overview/lg): see `Main._globalKeyPressHandler`,
* scrolling in the overview (`WorkspacesView.WorkspacesDisplay.controls` listens to `'scroll-event'`), and
* clicking in the overview.

---

# For developers wanting to improve this extension:

* The 'gnome3.2' branch is only compatible with GNOME 3.2. It's meant to be stable.
* The 'gnome3.4' branch is only compatible with GNOME 3.4 - things like keybinding names have changed since GNOME 3.2. It's meant to be stable.
* The 'default' branch is meant to be where development occurs. Push from this to the `gnome3.2` and `gnome3.4` branches.

Usually my `default` branch will run on both GNOME 3.2 and GNOME 3.4 to let me develop in both shells simultaneously (I switch a lot between a GNOME 3.2 and GNOME 3.4 computer), but in this case the GNOME 3.2 and 3.4 code is incompatible between versions. 

So at the moment (20/Aug/2011) the `default` branch is a GNOME 3.2 development branch, and I'll probably make a `gnome3.4-dev` branch for GNOME 3.4 development. I don't know - it's all a bit confusing :( If you have suggestions re repository structure please let me know! (For example: `default` branch is where `metadata.json`, `Readme.md` and common files have changes made to them, push these out to a `gnome3.2-dev` and `gnome3.4-dev` branch, and `gnome3.2-dev` pushes to `gnome3.2` and `gnome3.4-dev` pushes to `gnome3.4`?? How do other people do this sort of thing?)

## Known issues
From GNOME 3.4+ to keep workspaces static we can just adjust some settings:

* `org.gnome.shell.overrides.dynamic-workspaces` to `false`
* `org.gnome.desktop.wm.preferences.num-workspaces` to the number of workspaces

However then you can't drag/drop applications between workspaces (GNOME 3.4.1 anyway), so instead of doing that we make use of the Frippery Static Workspace code.
