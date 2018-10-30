# Workspace Grid GNOME Shell Extension

[![codebeat badge](https://codebeat.co/badges/094b19ec-27d6-48ca-abd8-71c9459690a8)](https://codebeat.co/projects/github-com-zakkak-workspace-grid-3-30) [![Build Status](https://travis-ci.org/zakkak/workspace-grid.svg)](https://travis-ci.org/zakkak/workspace-grid)

This extension allows you to configure your workspaces in a grid,
inspired by the [Frippery Static Workspaces extension](https://extensions.gnome.org/extension/12/static-workspaces/).

- Holds the number of workspaces fixed.
- Allows the user to specify the workspace layout (rows/columns).
- Updates the workspaces display in the overview to reflect the workspace grid layout.
- updates the workspace switcher/keybindings to reflect the workspace grid layout.

This extension was originally written in 2012 by [Amy Chan](mailto:mathematical.coffee@gmail.com?subject=workspace-grid%20question).

Maintained by [Foivos Zakkak](https://foivos.zakkak.net) since October, 2014.

Project webpage <https://github.com/zakkak/workspace-grid>.

Report bugs [on the Issues page at github](https://github.com/zakkak/workspace-grid-gnome-shell-extension/issues).

## Screenshots

![img](https://user-images.githubusercontent.com/1435395/28044317-581fca6c-65df-11e7-85eb-e0686f82787f.png)
![img](https://user-images.githubusercontent.com/1435395/28044318-585bd304-65df-11e7-925b-d1b66bf58282.png)

## Other relevant extensions

Combine these extensions with this one or just use these if this doesn't do what you want:

- If you use a bottom panel, [Frippery Bottom Panel](https://extensions.gnome.org/extension/3/bottom-panel/) **already has** workspace grid functionality.

- If you want a textual workspace indicator in your panel, use the
  [Workspace Indicator extension](https://extensions.gnome.org/extension/21/workspace-indicator/).

Let me know of similar (active) extensions to add to this list.

---

# Installation

1.  Download the .zip file on the [Downloads page](https://github.com/zakkak/workspace-grid-gnome-shell-extension/releases).
2.  Open `gnome-tweak-tool`, go to "Shell Extensions", "Install Extension" and select the .zip file.

Or

1.  Visit <https://extensions.gnome.org/extension/484/workspace-grid/>
2.  Install by clicking the toggle switch

# Configuration

## Quirks / Known Issues

1.  To avoid weird re-sizing of the thumbnails-box please enable the
    extension **User themes**, as well. **Workspace grid** currently
    overrides the css decoration to fix such behaviors.
2.  Before configuring workspace grid, set the _Workspace Creation_ in
    gnome tweak tool to _static_ and the _Number of Workspaces_ to the
    total number of workspaces you want to have.

## gnome-tweaks-tool (aka **Tweaks**)

    sudo apt install gnome-tweak-tool

Go to `Extension` an click on the gear next to `Workspace grid`.

### Configuration options:

- Number of rows/columns in the workspace.
- Reative workspace switching.

  When using relative navigation you always stay within current row of desktops.

  e.g.
  When you have 20 desktops (2 rows) and you're on desktop 15 and press Ctrl+2 (navigate to workspace 2), it actually switches to workspace 12 (opposed to workspace 2 if relative workspace navigation is not enabled).
  
- Whether workspaces wrap around.

  When navigating workspaces (via keybindings, scrolling over the
  workspace thumbnails in the Overview) do you want to wrap around
  from the start to the end (e.g. going past workspace `n` wraps
  back to workspace 1)?

- Whether to show workspace labels in the switcher.
- Scroll direction.
- Maximum width.

## dconf-editor

    sudo apt install dconf-editor

go to `/org/gnome/desktop/wm/preferences/workspace-names`

### Configuration options:
  To assign labels to workspaces add/change strings to the `Custom value` array.

  e.g.
  ![img](https://cloud.githubusercontent.com/assets/1435395/22392052/262a96de-e4fe-11e6-9dee-58377978693c.png)

## Hints

- Workspaces thumbnails sidebar in overview.

  This sidebar can get pretty wide if you have multiple columns of
  workspaces. The sidebar can be collapsed to the side of the screen
  if it becomes too wide so that you then hover your mouse over it
  to uncollapse it.

---

# For developers wanting to integrate with this extension

If you wish to see if your extension is compatible with this one,
these are things you need to know.

## Exported stuff

This extension exports a number of constants and functions to an object
global.{screen,workspace_manager}.workspace_grid (GNOME <= 3.28) or global.workspace_manager
(GNOME > 3.28) for your convenience.
(It isn't particularly good code style as this "breaks the extension
barrier" so to speak - extensions are meant to be standalone and
modular, but when multiple extensions have overlapping
functionalities it makes sense to use another extension's
functionality rather than re-implement it in your own).

Note that the Workspace Grid extension must be enabled for this all to
work. The `global.{screen,workspace_manager}.workspace_grid` object contains:

(Exported Constants)

- `Directions = { UP, LEFT, RIGHT, DOWN }` : directions for
  navigating (see `moveWorkspaces` further down) (**NOTE**: From 3.6+
  just use `Meta.MotionDirection.{UP, LEFT, RIGHT, DOWN}`)
- `rows` : number of rows of workspaces
- `columns` : number of columns of workspaces

(Exported Functions)

- `moveWorkspace` : switches workspaces in the direction specified,
  being either (`Directions.`)~UP~, `LEFT`, `RIGHT` or `DOWN` (see
  `Directions`).
- `rowColToIndex` : converts the row/column into an index for use
  with (e.g.) `global.{screen,workspace_manager}.get_workspace_by_index(i)`
- `indexToRowCol` : converts an index (`0 to global.{screen,workspace_manager}.n_workspaces-1`) to a row and column
- `calculateWorkspace` : calculates the index of the workspace
  adjacent in the specified direction to the current one.
- `getWorkspaceSwitcherPopup` : retrieves our workspace switcher
  popup.

For example, to move to the workspace below us:

    const WorkspaceGrid = global.{screen,workspace_manager}.workspace_grid;
    WorkspaceGrid.moveWorkspace(WorkspaceGrid.Directions.DOWN);

## Listening to Workspace Grid

Say you want to know the number of rows/columns of workspaces in
your extension. Then you have to wait for this extension to load
and populate `global.{screen,workspace_manager}.workspace_grid`.

When the Workspace Grid extension enables or disables it fires a
`'notify::n_workspaces'` signal on global.{screen,workspace_manager}.
You can connect to this and check for the existence (or removal) of
`global.{screen,workspace_manager}.workspace_grid`.

e.g.:

    let ID = global.{screen,workspace_manager}.connect('notify::n-workspaces', function () {
        if (global.{screen,workspace_manager}.workspace_grid) {
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

- keybindings (`Main.wm.setKeybindingHandler` (GNOME 3.2),
  `Meta.keybindings_set_custom_handler` (GNOME 3.4)),
- keybinding with global grab in progress (e.g. in Overview/lg):
  see `Main._globalKeyPressHandler`,
- scrolling in the overview
  (`WorkspacesView.WorkspacesDisplay.controls` listens to
  `'scroll-event'`), and
- clicking in the overview.

## Dev notes for this extension

From GNOME 3.4+ to keep workspaces static we can just do:

- org.gnome.shell.overrides.dynamic-workspaces false
- org.gnome.desktop.wm.preferences.num-workspaces <numworkspaces>

However then you can't drag/drop applications between workspaces (GNOME 3.4
and 3.6 anyway)

In 3.8 you can drag/drop between workspaces with dynamic-workspace off, but you
can't drag/drop to create a _new_ workspace (or at least you don't get the
animation showing that this is possible).

Hence we make use of the Frippery Static Workspace code.

See also the edited workspaces indicator
<http://kubiznak-petr.ic.cz/en/workspace-indicator.php> (this is column-major).
