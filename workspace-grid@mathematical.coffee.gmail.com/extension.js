/*global global, log */ // <-- jshint
/* Workspaces Grid GNOME shell extension.
 *
 * Inspired by Frippery Static Workspaces[0] by R. M. Yorston
 *
 * [0]: https://extensions.gnome.org/extension/12/static-workspaces/
 *
 * ----------------------------------------------------
 *
 * Dev notes
 * ---------
 * There is a global.screen.override_workspace_layout() which appears to do
 * nothing (perhaps because GNOME shell takes over the keybindings for changing
 * workspaces, etc).
 *
 * Also, there seems to be no way to query for the current number of rows/
 * columns of workspaces (from GJS).
 *
 * So, the system still sees the workspaces as being in a
 * column 0, ..., <nrows * ncols - 1>, but *we* see this as a grid of
 * workspaces, row-major, and 0-based.
 *
 * That is, workspace 0 is (row, col) = (0, 0), workspace 1 is
 * (row, col) = (0, 1) and so on.
 *
 * From GNOME 3.4+ to keep workspaces static we can just do:
 * - org.gnome.shell.overrides.dynamic-workspaces false
 * - org.gnome.desktop.wm.preferences.num-workspaces <numworkspaces>
 * (TODO: report of this losing the ability to drag n drop applications between
 * workspaces - check).
 *
 * See also the edited workspaces indicator
 * http://kubiznak-petr.ic.cz/en/workspace-indicator.php (this is column-major).
 *
 * TODO
 * ----
 * - workspace indicator (which you can toggle on/off) [perhaps separate ext.]
 *   - r-click to rename workspace (meta.prefs_change_workspace_name)
 *   - r-click to adjust rows/cols
 *   - see gnome-panel. (Click to drag ....)
 *   - also workspaceThumbnail ThumbnailsBox shows each window in each workspace
 *     preview - we just want a simplified version of that. (addThumbnails)
 * - modify workspacesDisplay (which you can toggle)
 *
 * GNOME 3.2 <-> GNOME 3.4
 * -----------------------
 * - Main.wm.setKeybindingHandler -> Meta.keybindings_set_custom_handler
 * - keybinding names '_' -> '-'
 * - keybinding callback: wm, binding, mask, window, backwards -> display, screen, window, binding
 * - keybinding callback: binding -> binding.get_name()
 *
 */

//// CONFIGURE HERE
const WORKSPACE_CONFIGURATION = {
    rows: 2,
    columns: 4
};


const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const IconGrid = imports.ui.iconGrid;
const Main = imports.ui.main;
const WorkspaceSwitcher = imports.ui.workspaceSwitcherPopup;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
/** to import files from extension
const MyFile = Me.imports.myFile;
*/

const UP = 'switch-to-workspace-up';
const DOWN = 'switch-to-workspace-down';
const LEFT = 'switch-to-workspace-left';
const RIGHT = 'switch-to-workspace-right';

let staticWorkspaceStorage = {};
let nWorkspaces;
let workspaceSwitcherPopup = null;

/***************
 * Helper functions
 ***************/

function dummy() {
    return false;
}

/* Convert to and from (row, col) <-> index (0 -- nrows*ncols-1)
 * all row/col/index coordinates are 0-based
 */
function indexToRowCol(index) {
    // row-major. 0-based.
    return [Math.floor(index / WORKSPACE_CONFIGURATION.columns),
       index % WORKSPACE_CONFIGURATION.columns];
}

function rowColToIndex(rowcol) {
    // row-major. 0-based.
    return rowcol[0] * WORKSPACE_CONFIGURATION.columns + rowcol[1];
}


/************
 * Workspace Switcher that can do rows and columns as opposed to just rows.
 ************/
// TODO: global.screen.rows_of_workspaces or WORKSPACE_CONFIG.rows ?
function WorkspaceSwitcherPopup() {
    this._init(this);
}

WorkspaceSwitcherPopup.prototype = {
    __proto__: WorkspaceSwitcher.WorkspaceSwitcherPopup.prototype,

    _init: function () {
        WorkspaceSwitcher.WorkspaceSwitcherPopup.prototype._init.call(this);
        this._list.destroy();
        this._list = null;
        this._container.style_class = '';

        this._grid = new IconGrid.IconGrid({
            rowLimit: WORKSPACE_CONFIGURATION.rows,
            columnLimit: WORKSPACE_CONFIGURATION.columns,
            xAlign: St.Align.MIDDLE
        });
        this._grid.actor.style_class = 'workspace-switcher-grid';

        this._container.add(this._grid.actor, {expand: true});

        this._redraw();
    },

    _redraw: function (direction, activeWorkspaceIndex) {
        if (!this._grid) {
            return;
        }

        // FIXME: don't destroy all the time, only when configuration changes.
        this._grid.removeAll();

        for (let i = 0; i < global.screen.n_workspaces; ++i) {
            let icon = new St.Bin({style_class: 'ws-switcher-box'}),
                primary = Main.layoutManager.primaryMonitor;
            this._grid.addItem(icon);
            icon.width = icon.height * primary.width / primary.height;
            // FIXME: above width is not being respected!
        }

        // It seems they also do row-major layout.
        let ch = this._grid.getItemAtIndex(activeWorkspaceIndex),
            style = null;
        switch (direction) {
        case UP:
            style = 'ws-switcher-active-up';
            break;
        case DOWN:
            style = 'ws-switcher-active-down';
            break;
        case RIGHT:
            style = 'ws-switcher-active-right';
            break;
        case LEFT:
            style = 'ws-switcher-active-left';
            break;
        }
        if (style) {
            ch.remove_style_class_name('ws-switcher-box');
            ch.add_style_class_name(style);
        }

        // FIXME: why does this._container not automatically stretch to
        // this._grid's height?
        this._container.height = this._grid._grid.height +
            this._grid.actor.get_theme_node().get_vertical_padding();
    }
};

/* Switch to the appropriate workspace.
 * (TODO: how else may the workspace be switched?)
 */
function moveWorkspace(direction) {
    let from = global.screen.get_active_workspace_index(),
        coord = indexToRowCol(from),
        to = coord;

    switch (direction) {
    case LEFT:
        to[1] = Math.max(0, coord[1] - 1);
        break;
    case RIGHT:
        to[1] = Math.min(WORKSPACE_CONFIGURATION.columns - 1, coord[1] + 1);
        break;
    case UP:
        to[0] = Math.max(0, coord[0] - 1);
        break;
    case DOWN:
        to[0] = Math.min(WORKSPACE_CONFIGURATION.rows - 1, coord[0] + 1);
        break;
    }
    to = rowColToIndex(to);
    //log('moving from workspace %d to %d'.format(from, to));
    if (to !== from) {
        global.screen.get_workspace_by_index(to).activate(
                global.get_current_time());
    }

    // show the workspace switcher popup
    if (!Main.overview.visible) {
        workspaceSwitcherPopup.display(direction, to);
    }
}


/* Keybinding handler.
 * Should bring up a workspace switcher.
 */
function showWorkspaceSwitcher(display, screen, window, binding) {
    if (global.screen.n_workspaces === 1)
        return;

    moveWorkspace(binding.get_name());
}

/******************
 * Overrides the 'switch_to_workspace_XXX' keybindings
 ******************/
function overrideKeybindingsAndPopup() {
    Meta.keybindings_set_custom_handler(LEFT, showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler(RIGHT, showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler(UP, showWorkspaceSwitcher);
    Meta.keybindings_set_custom_handler(DOWN, showWorkspaceSwitcher);
}

/* Restore the original keybindings
 * FIXME: Should we store Main.wm._keyBindingHandlers['switch_to_workspace_xxx']
 *  and restore these instead?
 */
function unoverrideKeybindingsAndPopup() {
    // Restore t
    Meta.keybindings_set_custom_handler(LEFT, Lang.bind(Main.wm,
                Main.wm.prototype._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler(RIGHT, Lang.bind(Main.wm,
                Main.wm.prototype._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler(UP, Lang.bind(Main.wm,
                Main.wm.prototype._showWorkspaceSwitcher));
    Meta.keybindings_set_custom_handler(DOWN, Lang.bind(Main.wm,
                Main.wm.prototype._showWorkspaceSwitcher));
}

/******************
 * Overrides the workspaces display in the overview
 ******************/
// UPTO
// TODO: it's going to look very ugly.
function overrideWorkspaceDisplay() {
    // see remove-workspaces-sidebar:
    // imports.ui.workspaceThumbnail.ThumbnailsBox
    // Main.overview._workspacesDisplay._thumbnailsBox.
    // addThumbnails: this.actor.add_actor(thumbnail.actor)
    // where thumbnail is a WorkspaceThumbnail.
}

function unoverrideWorkspaceDisplay() {
}

/******************
 * tells Meta about the number of workspaces we want
 ******************/
function modifyNumWorkspaces() {
    /// Storage
    nWorkspaces = Meta.prefs_get_num_workspaces();

    /// Setting the number of workspaces.
    Meta.prefs_set_num_workspaces(
        WORKSPACE_CONFIGURATION.rows * WORKSPACE_CONFIGURATION.columns
    );

    // This appears to do nothing but we'll do it in case it helps.
    global.screen.override_workspace_layout(
        Meta.ScreenCorner.TOPLEFT, // workspace 0
        false, // true == lay out in columns. false == lay out in rows
        WORKSPACE_CONFIGURATION.rows,
        WORKSPACE_CONFIGURATION.columns
    );
    global.screen.vertical_workspaces = false;
    global.screen.rows_of_workspaces = WORKSPACE_CONFIGURATION.rows;
    global.screen.columns_of_workspaces = WORKSPACE_CONFIGURATION.columns;
}

function unmodifyNumWorkspaces() {
    // restore original number of workspaces (though it doesn't really matter)
    Meta.prefs_set_num_workspaces(nWorkspaces);

    delete global.screen.vertical_workspaces;
    delete global.screen.rows_of_workspaces;
    delete global.screen.columns_of_workspaces;
}

/******************
 * This is the stuff from Frippery Static Workspaces
 ******************/
// FIXME: check in GNOME 3.4 about just using overrides.dynamic-workspaces.
function makeWorkspacesStatic() {
    /// storage
    staticWorkspaceStorage._nWorkspacesChanged = Main._nWorkspacesChanged;
    staticWorkspaceStorage._queueCheckWorkspaces = Main._queueCheckWorkspaces;
    staticWorkspaceStorage._checkWorkspaces = Main._checkWorkspaces;

    /// patching
    Main._nWorkspacesChanged = dummy;
    Main._queueCheckWorkspaces = dummy;
    Main._checkWorkspaces = dummy;

    Main._workspaces.forEach(function (workspace) {
            workspace.disconnect(workspace._windowAddedId);
            workspace.disconnect(workspace._windowRemovedId);
            workspace._lastRemovedWindow = null;
        });
}

function unmakeWorkspacesStatic() {
    // undo make workspaces static
    Main._nWorkspacesChanged = staticWorkspaceStorage._nWorkspacesChanged;
    Main._queueCheckWorkspaces = staticWorkspaceStorage._queueCheckWorkspaces;
    Main._checkWorkspaces = staticWorkspaceStorage._checkWorkspaces;

    Main._workspaces = [];

    // recalculate new number of workspaces.
    Main._nWorkspacesChanged();
}

/***************************
 *         EXTENSION       *
 ***************************/
function init() {
}

function enable() {
    makeWorkspacesStatic();
    modifyNumWorkspaces();
    overrideKeybindingsAndPopup();
    overrideWorkspaceDisplay();

    // create a workspace switcher popup (no hurry; wait until there's free
    // CPU)
    Mainloop.idle_add(function () {
        workspaceSwitcherPopup = new WorkspaceSwitcherPopup();
        // FIXME: for some reason the height is off the first time.
        // A quick show/hide will do the trick but surely there's a better way
        // (i.e. a reason why this occurs and I can address that directly)
        workspaceSwitcherPopup.actor.show();
        workspaceSwitcherPopup.actor.hide();
        return false;
    });
}

function disable() {
    unmodifyNumWorkspaces();
    unmakeWorkspacesStatic();
    unoverrideKeybindingsAndPopup();
    unoverrideWorkspaceDisplay();

    workspaceSwitcherPopup = null;
}
