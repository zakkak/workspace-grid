/***********************************************************************
 * Copyright (C) 2015-2018 Foivos S. Zakkak <foivos@zakkak.net>        *
 * Copyright (C) 2012-2014 Amy Chan <mathematical.coffee@gmail.com>    *
 *                                                                     *
 * This program is free software: you can redistribute it and/or       *
 * modify it under the terms of the GNU General Public License as      *
 * published by the Free Software Foundation, either version 3 of the  *
 * License, or (at your option) any later version.                     *
 *                                                                     *
 * This program is distributed in the hope that it will be useful, but *
 * WITHOUT ANY WARRANTY; without even the implied warranty of          *
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU   *
 * General Public License for more details.                            *
 *                                                                     *
 * You should have received a copy of the GNU General Public License   *
 * along with this program.  If not, see                               *
 * <http://www.gnu.org/licenses/>.                                     *
 ***********************************************************************/

/* Workspaces Grid GNOME shell extension.
 *
 * mathematical.coffee <mathematical.coffee@gmail.com>
 *
 * Inspired by Frippery Static Workspaces[0] by R. M. Yorston
 *
 * [0]: https://extensions.gnome.org/extension/12/static-workspaces/
 *
 * ----------------------------------------------------
 * Notes for other developers
 * --------------------------
 * If you wish to see if your extension is compatible with this, note:
 *
 * This extension exports a number of constants and functions to an object
 * global.screen.workspace_grid (GNOME <= 3.28) or global.workspace_manager
 * (GNOME > 3.28) for your convenience. Note that this extension must be enabled
 * for this all to work.
 * global.{screen,workspace_manager}.workspace_grid contains:
 *
 *   (Exported Constants)
 *   - rows     : number of rows of workspaces
 *   - columns  : number of columns of workspaces
 *
 *   (Exported Functions)
 *   - moveWorkspace : switches workspaces in the direction specified, being
 *                     either UP, LEFT, RIGHT or DOWN (see Meta.MotionDirection).
 *   - rowColToIndex : converts the row/column into an index for use with (e.g.)
 *                     global.{screen,workspace_manager}.get_workspace_by_index(i)
 *   - indexToRowCol : converts an index (0 to
 *                     global.{screen,workspace_manager}.n_workspaces-1) to a
 *                     row and column
 *   - getWorkspaceSwitcherPopup : gets our workspace switcher popup so you
 *                                 can show it if you want
 *   - calculateWorkspace : returns the workspace index in the specified direction
 *                          to the current, taking into account wrapping.
 *
 * For example, to move to the workspace below us:
 *     const WorkspaceGrid = global.{screen,workspace_manager}.workspace_grid;
 *     WorkspaceGrid.moveWorkspace(Meta.MotionDirection.DOWN);
 *
 * I am happy to try help/give an opinion/improve this extension to try make it
 *  more compatible with yours, email me :)
 *
 * Listening to workspace_grid
 * ---------------------------
 * Say you want to know the number of rows/columns of workspaces in your
 * extension. Then you have to wait for this extension to load and populate
 * global.{screen,workspace_manager}.workspace_grid.
 *
 * When the workspace_grid extension enables or disables it fires a
 *  'notify::n_workspaces' signal on global.{screen,workspace_manager}.
 *
 * You can connect to this and check for the existence (or removal) of
 * global.{screen,workspace_manager}.workspace_grid.
 *
 * Further notes
 * -------------
 * Workspaces can be changed by the user by a number of ways, and this extension
 * aims to cover them all:
 * - keybinding (wm.setCustomKeybindingHandler)
 * - keybinding with global grab in progress (e.g. in Overview/lg): see
 *    Main._globalKeyPressHandler
 * - scrolling in the overview (WorkspacesView.WorkspacesDisplay._onScrollEvent)
 * - clicking in the overview.
 *
 * Dev notes for this extension
 * ----------------------------
 * From GNOME 3.4+ to keep workspaces static we can just do:
 * - org.gnome.shell.overrides.dynamic-workspaces false
 * - org.gnome.desktop.wm.preferences.num-workspaces <numworkspaces>
 * However then you can't drag/drop applications between workspaces (GNOME 3.4
 *  and 3.6 anyway)
 * In 3.8 you can drag/drop between workspaces with dynamic-workspace off, but you
 *  can't drag/drop to create a *new* workspace (or at least you don't get the
 *  animation showing that this is possible).
 *
 * Hence we make use of the Frippery Static Workspace code.
 *
 * See also the edited workspaces indicator
 * http://kubiznak-petr.ic.cz/en/workspace-indicator.php (this is column-major).
 *
 * GNOME 3.2 <-> GNOME 3.4
 * -----------------------
 * - Main.wm.setKeybindingHandler -> Meta.keybindings_set_custom_handler
 * - keybinding names '_' -> '-'
 * - keybinding callback: wm, binding, mask, window, backwards ->
 *    display, screen, window, binding
 * - keybinding callback: binding -> binding.get_name()
 * - destroy_children <-> destroy_all_children
 * - In 3.4 thumbnails box has a dropPlaceholder for dropping windows into new
 *   workspaces
 *
 * GNOME 3.4 <-> GNOME 3.6
 * ---------
 * - WorkspaceSwitcherPopup gets *destroyed* every time it disappears
 * - Main.overview._workspacesDisplay -> Main.overview._viewSelector._workspacesDisplay
 * - The old WorkspaceSwitcherPopup _redraw + _position combined into _redisplay.
 * - Directions instead of being 'switch-to-workspace-*' are now Meta.MotionDirection
 * - The workspace popup also shows for 'move-to-workspace-*' binings.
 * - actionMoveWorkspace{Up,Down} --> actionMoveWorkspace
 *
 * GNOME 3.6 <-> GNOME 3.8
 * ---------
 * - Meta.keybindings_set_custom_handler -> Main.wm.setCustomKeybindingHandler
 *   (we've almost done a full loop back to 3.2...)
 * - use of setCustomKeybindingHandler allows modes (normal/overview) to be
 *    passed in, so it's no longer to override globalKeyPressHandler
 * - calculateWorkspace can use get_neighbor() which is now exposed.
 * - no need to reconstruct workspace controls (I think)
 * - _allocate code changed quite a bit to ensure thumbnails fit horizontally
 *    as the width given to _allocate is now the actual *onscreen* width
 *    (used to be the preferred width I think whether or not that fit on screen).
 */

////////// CODE ///////////
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Gio = imports.gi.Gio;

const DND = imports.ui.dnd;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;
const WorkspacesView = imports.ui.workspacesView;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Prefs = Me.imports.prefs;
const GridWorkspaceSwitcherPopup = Me.imports.gridWorkspaceSwitcherPopup;
const Utils = Me.imports.utils;

const KEY_ROWS = Prefs.KEY_ROWS;
const KEY_COLS = Prefs.KEY_COLS;
const KEY_WRAPAROUND = Prefs.KEY_WRAPAROUND;
const KEY_WRAP_TO_SAME = Prefs.KEY_WRAP_TO_SAME;
const KEY_WRAP_TO_SAME_SCROLL = Prefs.KEY_WRAP_TO_SAME_SCROLL;
const KEY_MAX_HFRACTION = Prefs.KEY_MAX_HFRACTION;
const KEY_MAX_HFRACTION_COLLAPSE = Prefs.KEY_MAX_HFRACTION_COLLAPSE;
const KEY_SHOW_WORKSPACE_LABELS = Prefs.KEY_SHOW_WORKSPACE_LABELS;
const KEY_SCROLL_DIRECTION = Prefs.KEY_SCROLL_DIRECTION;

const OVERRIDE_SCHEMA = "org.gnome.shell.overrides";

// laziness
const UP = Meta.MotionDirection.UP;
const DOWN = Meta.MotionDirection.DOWN;
const LEFT = Meta.MotionDirection.LEFT;
const RIGHT = Meta.MotionDirection.RIGHT;
const BindingToDirection = {
    "switch-to-workspace-up": UP,
    "switch-to-workspace-down": DOWN,
    "switch-to-workspace-left": LEFT,
    "switch-to-workspace-right": RIGHT,
    "move-to-workspace-up": UP,
    "move-to-workspace-down": DOWN,
    "move-to-workspace-left": LEFT,
    "move-to-workspace-right": RIGHT
};
/* it seems the max number of workspaces is 36
 * (MAX_REASONABLE_WORKSPACES in mutter/src/core/prefs.c)
 *
 * TODO: Remove the upper limit of workspaces, as it appears to not
 * exist in newer version of Gnome
 */
const MAX_WORKSPACES = 36;
const genBindings = function(prefix, count) {
    let bindings = [];
    for (let i = 1; i <= count; i++) {
        bindings.push(prefix + i);
    }
    return bindings;
};
const SwitchBindings = genBindings("switch-to-workspace-", MAX_WORKSPACES);
const MoveBindings = genBindings("move-to-workspace-", MAX_WORKSPACES);

/* Import some constants from other files and also some laziness */
const MAX_THUMBNAIL_SCALE = WorkspaceThumbnail.MAX_THUMBNAIL_SCALE;
const WORKSPACE_CUT_SIZE = WorkspaceThumbnail.WORKSPACE_CUT_SIZE;
const ThumbnailState = WorkspaceThumbnail.ThumbnailState;
const WMProto = WindowManager.WindowManager.prototype;
const TBProto = WorkspaceThumbnail.ThumbnailsBox.prototype;

/* storage for the extension */
let staticWorkspaceStorage = {};
let wmStorage = {};
let wvStorage = {};
let tbStorage = {};
let nWorkspaces;
let onScrollId = 0;
let settings = 0;

/***************
 * Helper functions
 ***************/
/* Converts an index (from 0 to global.{screen,workspace_manager}.n_workspaces)
 * into [row, column] being the row and column of workspace `index` according to
 * the user's layout.
 *
 * Row and column start from 0.
 */
function indexToRowCol(index) {
    // row-major. 0-based.
    return [
        Math.floor(index / Utils.WS.getWS().workspace_grid.columns),
        index % Utils.WS.getWS().workspace_grid.columns
    ];
}

/* Converts a row and column (0-based) into the index of that workspace.
 *
 * If the resulting index is greater than MAX_WORKSPACES (the maximum number
 * of workspaces allowable by Mutter), it will return -1.
 */
function rowColToIndex(row, col) {
    // row-major. 0-based.
    let idx = row * Utils.WS.getWS().workspace_grid.columns + col;
    if (idx >= MAX_WORKSPACES) {
        idx = -1;
    }
    return idx;
}

/** Gets the workspace switcher popup, creating if it doesn't exist. */
function getWorkspaceSwitcherPopup() {
    if (Main.wm._workspaceSwitcherPopup == null) {
        Main.wm._workspaceTracker.blockUpdates();
        Main.wm._workspaceSwitcherPopup = new GridWorkspaceSwitcherPopup.gridWorkspaceSwitcherPopup(
            settings
        );
        Main.wm._workspaceSwitcherPopup.connect(
            "destroy",
            Lang.bind(Main.wm, function() {
                Main.wm._workspaceTracker.unblockUpdates();
                Main.wm._workspaceSwitcherPopup = null;
                Main.wm._isWorkspacePrepended = false;
            })
        );
    }
    return Main.wm._workspaceSwitcherPopup;
}

/* Same as: from.get_neighbor(direction).index();
 * Workaround for GNOME 3.29.90.
 * Bug report: https://gitlab.gnome.org/GNOME/mutter/issues/270
 */
function get_neighbor(direction, from) {
    let [row, col] = indexToRowCol(from.index());

    switch (direction) {
        case LEFT:
            col = Math.max(0, col - 1);
            break;
        case RIGHT:
            col = Math.min(
                Utils.WS.getWS().workspace_grid.columns - 1,
                col + 1
            );
            break;
        case UP:
            row = Math.max(0, row - 1);
            break;
        case DOWN:
            row = Math.min(Utils.WS.getWS().workspace_grid.rows - 1, row + 1);
            break;
    }

    return rowColToIndex(row, col);
}

function calculateScrollDirection(direction, scrollDirection) {
    if (scrollDirection === "horizontal") {
        switch (direction) {
            case UP:
                direction = LEFT;
                break;
            case DOWN:
                direction = RIGHT;
                break;
        }
    }
    return direction;
}

// calculates the workspace index in that direction.
function calculateWorkspace(
    direction,
    wraparound,
    wrapToSame,
    wrapToSameScroll,
    overrideScrollDirection
) {
    if (overrideScrollDirection) {
        direction = calculateScrollDirection(
            direction,
            settings.get_string(KEY_SCROLL_DIRECTION)
        );
        if (!wrapToSameScroll) wrapToSame = wrapToSameScroll;
    }

    let from = Utils.WS.getWS().get_active_workspace(),
        to = get_neighbor(direction, from);

    if (!wraparound || from.index() !== to) {
        return to;
    }

    // otherwise, wraparound is TRUE and from === to (we are at the edge)
    let [row, col] = indexToRowCol(from.index());
    switch (direction) {
        case LEFT:
            // we must be at the start of the row. go to the end of the row.
            col = Utils.WS.getWS().workspace_grid.columns - 1;
            if (!wrapToSame) row--;
            break;
        case RIGHT:
            // we must be at the end of the row. go to the start of the same row.
            col = 0;
            if (!wrapToSame) row++;
            break;
        case UP:
            // we must be at the top of the col. go to the bottom of the same col.
            row = Utils.WS.getWS().workspace_grid.rows - 1;
            if (!wrapToSame) col--;
            break;
        case DOWN:
            // we must be at the bottom of the col. go to the top of the same col.
            row = 0;
            if (!wrapToSame) col++;
            break;
    }
    if (col < 0 || row < 0) {
        to = Utils.WS.getWS().n_workspaces - 1;
    } else if (
        col > Utils.WS.getWS().workspace_grid.columns - 1 ||
        row > Utils.WS.getWS().workspace_grid.rows - 1
    ) {
        to = 0;
    } else {
        to = rowColToIndex(row, col);
    }
    return to;
}

/* Switch to the appropriate workspace, showing the workspace switcher.
 * direction is either UP, LEFT, RIGHT or DOWN.
 *
 * This can occur through:
 * - keybinding (wm.setCustomKeybindingHandler)
 * - keybinding with global grab in progress (e.g. Overview/lg)
 * - scrolling/clicking in the overview
 * - (other extensions, e.g. navigate with up/down arrows:
 *        https://extensions.gnome.org/extension/29/workspace-navigator/)
 */
function moveWorkspace(direction) {
    // This is a boolean passed to the actionMoveWorkspace function.
    // If overrideScrollDirection is TRUE and scroll-direction is HORIZONTAL,
    // it overrides the UP and DOWN directions to LEFT and RIGHT.
    // This boolean defaults to TRUE.
    //
    // Here this behaviour is not needed because we are handling the keyboard
    // arrow shortcuts and all directions are valid. So we will set to FALSE.
    //
    let overrideScrollDirection = false;
    let newWs = actionMoveWorkspace(direction, overrideScrollDirection);

    // show workspace switcher
    if (!Main.overview.visible) {
        getWorkspaceSwitcherPopup().display(direction, newWs.index());
    }
}

/* Keybinding handler.
 * Should bring up a workspace switcher.
 * Either activates the target workspace or if it's move-to-workspace-xxx
 * we should move the window as well as show the workspace switcher.
 * This is the same as WindowManager._showWorkspaceSwitcher but we don't
 * filter out RIGHT/LEFT actions like they do.
 */
function showWorkspaceSwitcher(display, arg2, arg3, arg4) {
    let screen;
    let window;
    let binding;
    // Note: in v3.30, the 2nd arg (screen that we don't need) has been removed
    if (Utils.isVersionAbove(3, 28)) {
        screen = display.get_workspace_manager();
        window = arg2;
        binding = arg3;
    } else {
        screen = arg2;
        window = arg3;
        binding = arg4;
    }

    if (!Main.sessionMode.hasWorkspaces) return;

    if (Utils.WS.getWS().n_workspaces === 1) return;

    let [action, , , target] = binding.get_name().split("-");
    let newWs;
    let direction;

    if (action == "move") {
        // "Moving" a window to another workspace doesn't make sense when
        // it cannot be unstuck, and is potentially confusing if a new
        // workspaces is added at the start/end
        if (
            window.is_always_on_all_workspaces() ||
            (Meta.prefs_get_workspaces_only_on_primary() &&
                window.get_monitor() != Main.layoutManager.primaryIndex)
        )
            return;
    }

    if (target == "last") {
        newWs = screen.get_workspace_by_index(screen.n_workspaces - 1);
    } else if (isNaN(target)) {
        // Prepend a new workspace dynamically
        if (
            screen.get_active_workspace_index() == 0 &&
            action == "move" &&
            (target == "up" || target == "left")
        ) {
            Main.wm.insertWorkspace(0);
        }

        direction = Meta.MotionDirection[target.toUpperCase()];
    } else if (target > 0) {
        target--;
        if (settings.get_boolean(Prefs.KEY_RELATIVE_WORKSPACE_SWITCHING)) {
            target =
                target +
                Math.floor(
                    screen.get_active_workspace_index() /
                        Utils.WS.getWS().workspace_grid.columns
                ) *
                    Utils.WS.getWS().workspace_grid.columns;
        }
        newWs = screen.get_workspace_by_index(target);
    }

    if (newWs != null) {
        if (action == "switch") {
            Main.wm.actionMoveWorkspace(newWs);
        } else {
            Main.wm.actionMoveWindow(window, newWs);
        }
        // Use dummy direction
        direction = Meta.MotionDirection.UP;
    } else {
        if (action == "switch") {
            newWs = actionMoveWorkspace(direction, false);
        } else {
            newWs = actionMoveWindow(window, direction);
        }
    }

    // show workspace switcher
    if (!Main.overview.visible) {
        getWorkspaceSwitcherPopup().display(direction, newWs.index());
    }
}

function actionMoveWorkspace(destination, overrideScrollDirection = true) {
    let from = Utils.WS.getWS().get_active_workspace_index();

    let to;
    // destination >= 0 is workspace index, otherwise its a direction
    if (destination >= 0) to = destination;
    else
        to = calculateWorkspace(
            destination,
            settings.get_boolean(KEY_WRAPAROUND),
            settings.get_boolean(KEY_WRAP_TO_SAME),
            settings.get_boolean(KEY_WRAP_TO_SAME_SCROLL),
            overrideScrollDirection
        );

    let ws = Utils.WS.getWS().get_workspace_by_index(to);

    // if ws is null, the workspace does't exist, so keep on actual workspace
    if (ws == null) {
        ws = Utils.WS.getWS().get_active_workspace();
    }

    if (to !== from) {
        ws.activate(global.get_current_time());
    }
    return ws;
}

function actionMoveWindow(window, destination) {
    let to;
    // destination >= 0 is workspace index, otherwise its a direction
    if (destination >= 0) to = destination;
    else
        to = calculateWorkspace(
            destination,
            settings.get_boolean(KEY_WRAPAROUND),
            settings.get_boolean(KEY_WRAP_TO_SAME)
        );

    let ws = Utils.WS.getWS().get_workspace_by_index(to);

    if (to !== Utils.WS.getWS().get_active_workspace_index()) {
        Main.wm._movingWindow = window;
        window.change_workspace(ws);
        global.display.clear_mouse_mode();
        ws.activate_with_focus(window, global.get_current_time());
    }
    return ws;
}

/******************
 * Overrides the 'switch_to_workspace_XXX' keybindings
 * Relevant code in js/windowManager.js
 ******************/
function overrideKeybindingsAndPopup() {
    // note - we could simply replace Main.wm._workspaceSwitcherPopup and
    // not bother with taking over the keybindings, if not for the 'wraparound'
    // stuff.
    let bindings = Object.keys(BindingToDirection)
        .concat(SwitchBindings)
        .concat(MoveBindings);
    for (let i = 0; i < bindings.length; ++i) {
        Main.wm.setCustomKeybindingHandler(
            bindings[i],
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            showWorkspaceSwitcher
        );
    }
}

/* Restore the original keybindings */
function unoverrideKeybindingsAndPopup() {
    let bindings = Object.keys(BindingToDirection)
        .concat(SwitchBindings)
        .concat(MoveBindings);
    for (let i = 0; i < bindings.length; ++i) {
        Main.wm.setCustomKeybindingHandler(
            bindings[i],
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            Lang.bind(Main.wm, Main.wm._showWorkspaceSwitcher)
        );
    }

    Main.wm._workspaceSwitcherPopup = null;
}

// GNOME 3.2 & 3.4: Main.overview._workspacesDisplay
// GNOME 3.6, 3.8: Main.overview._viewSelector._workspacesDisplay
function _getWorkspaceDisplay() {
    return (
        Main.overview._workspacesDisplay ||
        Main.overview.viewSelector._workspacesDisplay ||
        Main.overview._viewSelector._workspacesDisplay
    );
}

/******************
 * Overrides the workspaces display in the overview
 ******************/
class ThumbnailsBox extends WorkspaceThumbnail.ThumbnailsBox {
    /**
     * The following are overridden simply to incorporate ._indicatorX in the
     * same way as ._indicatorY
     **/
    _init() {
        // Note: we could just call this.parent(); this._inicatorX = 0; but
        // instead we replicate this.parent()'s code here so we can store
        // the signal IDs (it connects to Main.overview) so that we can delete
        // them properly on destroy!

        this.actor = new Shell.GenericContainer({
            reactive: true,
            style_class: "workspace-thumbnails",
            request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT
        });
        this.actor.connect(
            "get-preferred-width",
            this._getPreferredWidth.bind(this)
        );
        this.actor.connect(
            "get-preferred-height",
            this._getPreferredHeight.bind(this)
        );
        this.actor.connect(
            "allocate",
            this._allocate.bind(this)
        );
        this.actor._delegate = this;

        let indicator = new St.Bin({
            style_class: "workspace-thumbnail-indicator"
        });

        // We don't want the indicator to affect drag-and-drop
        Shell.util_set_hidden_from_pick(indicator, true);

        this._indicator = indicator;
        this.actor.add_actor(indicator);

        this._dropWorkspace = -1;
        this._dropPlaceholderPos = -1;
        this._dropPlaceholder = new St.Bin({ style_class: "placeholder" });
        this.actor.add_actor(this._dropPlaceholder);
        this._spliceIndex = -1;

        this._targetScale = 0;
        this._scale = 0;
        this._pendingScaleUpdate = false;
        this._stateUpdateQueued = false;
        this._animatingIndicator = false;
        this._indicatorY = 0; // only used when _animatingIndicator is true

        this._stateCounts = {};
        for (let key in ThumbnailState)
            this._stateCounts[ThumbnailState[key]] = 0;

        this._thumbnails = [];

        this.actor.connect(
            "button-press-event",
            () => Clutter.EVENT_STOP
        );
        this.actor.connect(
            "button-release-event",
            this._onButtonRelease.bind(this)
        );
        this.actor.connect(
            "touch-event",
            this._onTouchEvent.bind(this)
        );

        // @@ only change: store these IDs! (TODO: submit patch)
        this._signals = [];
        this._signals.push(
            Main.overview.connect(
                "showing",
                this._createThumbnails.bind(this)
            )
        );
        this._signals.push(
            Main.overview.connect(
                "hidden",
                this._destroyThumbnails.bind(this)
            )
        );
        this._signals.push(
            Main.overview.connect(
                "item-drag-begin",
                this._onDragBegin.bind(this)
            )
        );
        this._signals.push(
            Main.overview.connect(
                "item-drag-end",
                this._onDragEnd.bind(this)
            )
        );
        this._signals.push(
            Main.overview.connect(
                "item-drag-cancelled",
                this._onDragCancelled.bind(this)
            )
        );
        this._signals.push(
            Main.overview.connect(
                "window-drag-begin",
                this._onDragBegin.bind(this)
            )
        );
        this._signals.push(
            Main.overview.connect(
                "window-drag-end",
                this._onDragEnd.bind(this)
            )
        );
        this._signals.push(
            Main.overview.connect(
                "window-drag-cancelled",
                this._onDragCancelled.bind(this)
            )
        );

        this._settings = new Gio.Settings({ schema: OVERRIDE_SCHEMA });
        this._dynamicWorkspacesId = this._settings.connect(
            "changed::dynamic-workspaces",
            this._updateSwitcherVisibility.bind(this)
        );

        Main.layoutManager.connect(
            "monitors-changed",
            this._rebuildThumbnails.bind(this)
        );

        // @@ added
        this._indicatorX = 0; // to match indicatorY
    }

    /* when the user clicks on a thumbnail take into account the x position
     * of that thumbnail as well as the y to determine which was clicked */
    _onButtonRelease(actor, event) {
        let [stageX, stageY] = event.get_coords();
        let [r, x, y] = this.actor.transform_stage_point(stageX, stageY);

        for (let i = 0; i < this._thumbnails.length; i++) {
            let thumbnail = this._thumbnails[i];
            let [w, h] = thumbnail.actor.get_transformed_size();
            // add in the x criteria
            if (
                y >= thumbnail.actor.y &&
                y <= thumbnail.actor.y + h &&
                x >= thumbnail.actor.x &&
                x <= thumbnail.actor.x + w
            ) {
                thumbnail.activate(event.get_time());
                break;
            }
        }

        return true;
    }

    /* with drag and drop: modify to look at the x direction as well as the y */
    handleDragOver(source, actor, x, y, time) {
        if (
            !source.realWindow &&
            !source.shellWorkspaceLaunch &&
            source != Main.xdndHandler
        )
            return DND.DragMotionResult.CONTINUE;

        let spacing = this.actor.get_theme_node().get_length("spacing");

        // There used to be lots of code about dragging a window either:
        //
        // * on a workspace, or:
        // * in the space "between" workspaces, in which case a new workspace
        //   is inserted if the window is dropped there.
        //
        // I do not support the second behaviour in this extension because
        // the number of workspaces is fixed (so there's no concept of adding
        // a new workspace).
        //
        // Instead I'll just add an indicator as to which workspace is to be
        // dropped onto (Note - might be a handy extension).
        let newDropWorkspace = -1;
        for (let i = 0; i < this._thumbnails.length; ++i) {
            let th = this._thumbnails[i].actor;
            let [w, h] = th.get_transformed_size();
            if (x >= th.x && x <= th.x + w && y >= th.y && y <= th.y + h) {
                newDropWorkspace = i;
                break;
            }
        }
        if (newDropWorkspace !== this._dropPlaceholderPos) {
            this._dropPlaceholderPos = newDropWorkspace;
            this._dropWorkspace = newDropWorkspace;
            this.actor.queue_relayout();
        }

        if (this._dropWorkspace !== -1)
            return this._thumbnails[this._dropWorkspace].handleDragOverInternal(
                source,
                time
            );
        else return DND.DragMotionResult.CONTINUE;
    }

    /* stuff to do with the indicator around the current workspace */
    set indicatorX(indicatorX) {
        this._indicatorX = indicatorX;
        //this.actor.queue_relayout(); // <-- we only ever change indicatorX
        // when we change indicatorY and that already causes a queue_relayout
        // so we omit it here so as not to have double the relayout requests..
    }

    get indicatorX() {
        return this._indicatorX;
    }

    _activeWorkspaceChanged() {
        let thumbnail;
        let activeWorkspace = Utils.WS.getWS().get_active_workspace();
        for (let i = 0; i < this._thumbnails.length; i++) {
            if (this._thumbnails[i].metaWorkspace === activeWorkspace) {
                thumbnail = this._thumbnails[i];
                break;
            }
        }

        this._animatingIndicator = true;
        Tweener.addTween(this, {
            indicatorY: thumbnail.actor.allocation.y1,
            indicatorX: thumbnail.actor.allocation.x1, // added
            time: WorkspacesView.WORKSPACE_SWITCH_TIME,
            transition: "easeOutQuad",
            onComplete: function() {
                this._animatingIndicator = false;
                this._queueUpdateStates();
            },
            onCompleteScope: this
        });
    }

    _getPreferredHeight(actor, forWidth, alloc) {
        // Note that for getPreferredWidth/Height we cheat a bit and skip propagating
        // the size request to our children because we know how big they are and know
        // that the actors aren't depending on the virtual functions being called.

        if (!this._ensurePorthole()) {
            alloc.min_size = -1;
            alloc.natural_size = -1;
            return;
        }

        let themeNode = this.actor.get_theme_node();

        let spacing = themeNode.get_length("spacing");
        let nWorkspaces = Utils.WS.getWS().workspace_grid.rows;
        let totalSpacing = (nWorkspaces - 1) * spacing;

        alloc.min_size = totalSpacing;
        alloc.natural_size =
            totalSpacing +
            nWorkspaces * this._porthole.height * MAX_THUMBNAIL_SCALE;
    }

    /**
     * The following are to get things to layout in a grid
     * Note: the mode is WIDTH_FOR_HEIGHT, and we make sure that the box is
     * no wider than MAX_SCREEN_HFRACTION fraction of the screen width wide.
     * If it is wider than MAX_SCREEN_HFRACTION_COLLAPSE then we initially
     * start the thumbnails box collapsed.
     **/
    _getPreferredWidth(actor, forHeight, alloc) {
        if (this._thumbnails.length === 0) {
            return;
        }

        let themeNode = this.actor.get_theme_node(),
            spacing = this.actor.get_theme_node().get_length("spacing"),
            nRows = Utils.WS.getWS().workspace_grid.rows,
            nCols = Utils.WS.getWS().workspace_grid.columns,
            totalSpacingX = (nCols - 1) * spacing,
            totalSpacingY = (nRows - 1) * spacing,
            availY = forHeight - totalSpacingY,
            scale =
                availY < 0
                    ? MAX_THUMBNAIL_SCALE
                    : availY / nRows / this._porthole.height;

        // 'scale' is the scale we need to fit `nRows` of workspaces in the
        // available height (after taking into account padding).
        scale = Math.min(scale, MAX_THUMBNAIL_SCALE);

        let width = totalSpacingX + nCols * this._porthole.width * scale,
            maxWidth =
                Main.layoutManager.primaryMonitor.width *
                    settings.get_double(KEY_MAX_HFRACTION) -
                this.actor.get_theme_node().get_horizontal_padding() -
                themeNode.get_horizontal_padding();
        // store the horizontal scale for use in _allocate.
        this._maxHscale =
            (maxWidth - totalSpacingX) / nCols / this._porthole.width;

        width = Math.min(maxWidth, width);

        // natural width is nCols of workspaces + (nCols-1)*spacingX
        [alloc.min_size, alloc.natural_size] = themeNode.adjust_preferred_width(
            width,
            width
        );
    }

    _allocate(actor, box, flags) {
        let rtl =
            Clutter.get_default_text_direction() == Clutter.TextDirection.RTL;

        // See comment about this._background in _init()
        let themeNode = this.actor.get_theme_node();
        let contentBox = themeNode.get_content_box(box);

        if (this._thumbnails.length == 0)
            // not visible
            return;

        let portholeWidth = this._porthole.width;
        let portholeHeight = this._porthole.height;
        let spacing = this.actor.get_theme_node().get_length("spacing");

        // Compute the scale we'll need once everything is updated
        let nCols = Utils.WS.getWS().workspace_grid.columns,
            nRows = Utils.WS.getWS().workspace_grid.rows,
            totalSpacingY = (nRows - 1) * spacing,
            availY = contentBox.y2 - contentBox.y1 - totalSpacingY;

        // work out what scale we need to squeeze all the rows/cols of
        // workspaces in
        let newScale = Math.min(
            availY / nRows / portholeHeight,
            MAX_THUMBNAIL_SCALE
        );
        if (this._maxHscale) {
            // ensure we fit horizontally too.
            newScale = Math.min(this._maxHscale, newScale);
        }

        if (newScale != this._targetScale) {
            if (this._targetScale > 0) {
                // We don't do the tween immediately because we need to observe the ordering
                // in queueUpdateStates - if workspaces have been removed we need to slide them
                // out as the first thing.
                this._targetScale = newScale;
                this._pendingScaleUpdate = true;
            } else {
                this._targetScale = this._scale = newScale;
            }

            this._queueUpdateStates();
        }

        let thumbnailHeight = portholeHeight * this._scale,
            thumbnailWidth = Math.round(portholeWidth * this._scale),
            thumbnailsWidth = thumbnailWidth * nCols + spacing * (nCols - 1);

        let childBox = new Clutter.ActorBox();

        // The background is horizontally restricted to correspond to the current thumbnail size
        // but otherwise covers the entire allocation
        if (rtl) {
            childBox.x1 = box.x1;
            childBox.x2 =
                box.x2 - (contentBox.x2 - contentBox.x1 - thumbnailsWidth);
        } else {
            childBox.x1 =
                box.x1 + (contentBox.x2 - contentBox.x1 - thumbnailsWidth);
            childBox.x2 = box.x2;
        }
        childBox.y1 = box.y1;
        childBox.y2 = box.y2;
        //        this._background.allocate(childBox, flags);

        let indicatorY1 = this._indicatorY,
            indicatorX1 = this._indicatorX,
            indicatorY2,
            indicatorX2,
            // when not animating, the workspace position overrides this._indicatorY
            indicatorWorkspace = !this._animatingIndicator
                ? Utils.WS.getWS().get_active_workspace()
                : null,
            indicatorThemeNode = this._indicator.get_theme_node(),
            indicatorTopFullBorder =
                indicatorThemeNode.get_padding(St.Side.TOP) +
                indicatorThemeNode.get_border_width(St.Side.TOP),
            indicatorBottomFullBorder =
                indicatorThemeNode.get_padding(St.Side.BOTTOM) +
                indicatorThemeNode.get_border_width(St.Side.BOTTOM),
            indicatorLeftFullBorder =
                indicatorThemeNode.get_padding(St.Side.LEFT) +
                indicatorThemeNode.get_border_width(St.Side.LEFT),
            indicatorRightFullBorder =
                indicatorThemeNode.get_padding(St.Side.RIGHT) +
                indicatorThemeNode.get_border_width(St.Side.RIGHT);

        if (this._dropPlaceholderPos == -1) {
            Meta.later_add(
                Meta.LaterType.BEFORE_REDRAW,
                Lang.bind(this, function() {
                    this._dropPlaceholder.hide();
                })
            );
        }
        let dropPlaceholderPosX1,
            dropPlaceholderPosX2,
            dropPlaceholderPosY1,
            dropPlaceholderPosY2;

        // TODO: rtl.
        // Note: in theory I don't have to worry about the collapseFraction/slidePosition
        // stuff because since the number of workspaces is static, thumbnails
        // will never end up sliding in/out or collapsing
        // (when a workspace is destroyed it slides out horizontally then the
        //  space collapses vertically)
        // Hence I ignore all of the collapseFraction/slidePosition stuff.
        let y = contentBox.y1 + (availY - nRows * thumbnailHeight) / 2, // centre
            x = rtl ? contentBox.x1 : contentBox.x2 - thumbnailsWidth,
            i = 0;
        for (let row = 0; row < nRows; ++row) {
            // We might end up with thumbnailHeight being something like 99.33
            // pixels. To make this work and not end up with a gap at the bottom,
            // we need some thumbnails to be 99 pixels and some 100 pixels height;
            // we compute an actual scale separately for each thumbnail.
            let y1 = Math.round(y),
                y2 = Math.round(y + thumbnailHeight),
                roundedVScale = (y2 - y1) / portholeHeight;
            // reset x.
            x = rtl ? contentBox.x1 : contentBox.x2 - thumbnailsWidth;
            for (let col = 0; col < nCols; ++col) {
                let thumbnail = this._thumbnails[i];
                let x1 = Math.round(x),
                    x2 = Math.round(x + thumbnailWidth),
                    roundedHScale = (x2 - x1) / portholeWidth;

                if (thumbnail.metaWorkspace == indicatorWorkspace) {
                    indicatorY1 = y1;
                    indicatorY2 = y2;
                    indicatorX1 = x1;
                    indicatorX2 = x2;
                }

                if (i === this._dropPlaceholderPos) {
                    dropPlaceholderPosX1 = x1;
                    dropPlaceholderPosX2 = x2;
                    dropPlaceholderPosY1 = y1;
                    dropPlaceholderPosY2 = y2;
                }

                // Allocating a scaled actor is funny - x1/y1 correspond to the
                // origin of the actor, but x2/y2 are increased by the unscaled
                // size.
                childBox.x1 = x1;
                childBox.x2 = x1 + portholeWidth;
                childBox.y1 = y1;
                childBox.y2 = y1 + portholeHeight;

                thumbnail.actor.set_scale(roundedHScale, roundedVScale);
                thumbnail.actor.allocate(childBox, flags);

                x += thumbnailWidth + spacing;
                ++i;
                if (i >= MAX_WORKSPACES || i >= this._thumbnails.length) {
                    break;
                }
            } // col loop
            if (i >= MAX_WORKSPACES || i >= this._thumbnails.length) {
                break;
            }
            y += thumbnailHeight + spacing;
        } // row loop
        // allocate the indicator
        childBox.x1 = indicatorX1 - indicatorLeftFullBorder;
        childBox.x2 =
            (indicatorX2 ? indicatorX2 : indicatorX1 + thumbnailWidth) +
            indicatorLeftFullBorder;
        childBox.y1 = indicatorY1 - indicatorTopFullBorder;
        childBox.y2 =
            (indicatorY2 ? indicatorY2 : indicatorY1 + thumbnailHeight) +
            indicatorBottomFullBorder;
        if (!this._animatingIndicator) {
            this._indicatorX = indicatorX1;
            this._indicatorY = indicatorY1;
        }
        this._indicator.allocate(childBox, flags);

        if (dropPlaceholderPosX1) {
            childBox.x1 = dropPlaceholderPosX1;
            childBox.x2 = dropPlaceholderPosX2;
            childBox.y1 = dropPlaceholderPosY1;
            childBox.y2 = dropPlaceholderPosY2;
            this._dropPlaceholder.allocate(childBox, flags);
            Meta.later_add(
                Meta.LaterType.BEFORE_REDRAW,
                Lang.bind(this, function() {
                    this._dropPlaceholder.show();
                })
            );
        }
    }

    destroy() {
        this.actor.destroy();
        let i = this._signals.length;
        while (i--) {
            Main.overview.disconnect(this._signals[i]);
        }
        this._signals = [];
        this._settings.disconnect(this._dynamicWorkspacesId);
    }
}

/* Get the thumbnails box to acknowledge a change in allowable width */
function refreshThumbnailsBox() {
    if (Main.overview.visible) {
        // we hope that when they close the overview and reopen it, that will
        // do the trick.
        // (they can't really use the prefs widget while in the overview anyway)
        return;
    }
    // get the thumbnailsbox to re-allocate itself
    Main.overview._controls._thumbnailsBox.actor.queue_relayout();
    Main.overview._controls._thumbnailsSlider.actor.queue_relayout();
}

/** Does everything in ThumbnailsBox._init to do with this.actor so that I
 * can patch it.
 * Use it like:
 *
 *     _makeNewThumbnailsBoxActor.call(whatever_is_this, ThumbnailsBox.prototype);
 *
 */
function _replaceThumbnailsBoxActor(actorCallbackObject) {
    let slider = Main.overview._controls._thumbnailsSlider,
        thumbnailsBox = Main.overview._controls._thumbnailsBox;

    // kill the old actor
    slider.actor.remove_actor(thumbnailsBox.actor);
    thumbnailsBox.actor.remove_actor(thumbnailsBox._indicator);
    thumbnailsBox.actor.remove_actor(thumbnailsBox._dropPlaceholder);
    thumbnailsBox.actor.destroy();

    // make our own actor and slot it in to the existing thumbnailsBox.actor
    (function(patch) {
        this.actor = new Shell.GenericContainer({
            reactive: true,
            style_class: "workspace-thumbnails",
            request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT
        });
        this.actor.connect(
            "get-preferred-width",
            Lang.bind(this, patch._getPreferredWidth)
        );
        this.actor.connect(
            "get-preferred-height",
            Lang.bind(this, patch._getPreferredHeight)
        );
        this.actor.connect(
            "allocate",
            Lang.bind(this, patch._allocate)
        );
        this.actor._delegate = this;

        //        this.actor.add_actor(this._background);
        this.actor.add_actor(this._indicator);
        this.actor.add_actor(this._dropPlaceholder);

        this.actor.connect(
            "button-press-event",
            function() {
                return true;
            }
        );
        this.actor.connect(
            "button-release-event",
            Lang.bind(this, patch._onButtonRelease)
        );
    }.call(thumbnailsBox, actorCallbackObject));

    thumbnailsBox.actor.y_expand = true;
    slider.actor.add_actor(thumbnailsBox.actor);
}

/**
 * We need to:
 * 1) override the scroll event on workspaces display to allow sideways
 *    scrolling too
 * 2) replace the old thumbnailsBox with our own (because you can't
 *    override ._getPreferredHeight etc that are passed in as *callbacks*).
 */
function overrideWorkspaceDisplay() {
    if (Main.overview.visible) {
        Main.overview.hide();
    }
    // 1. Override the scroll event.
    //    The _onScrollEvent function itself is quite fine, except it only allows
    //     scrolling up and down.
    //    For completeness I also allow scrolling left/right (though I can't test...)
    //    Note that this is done differently in GNOME 3.8: the event is triggered
    //     from each individual workspaces view in the workspaceDisplay rather
    //     than from the 'controls' object.
    wvStorage._init = WorkspacesView.WorkspacesView.prototype._init;
    WorkspacesView.WorkspacesView.prototype._init = function() {
        wvStorage._init.apply(this, arguments);
        Main.overview.connect(
            "scroll-event",
            Lang.bind(this, _scrollHandler)
        );
        /* FelipeMarinho97 - <felipevm97@gmail.com>:
         *
         * This function **_scrollHandler**, uses a exported function
         * global.{screen,workspace_manager}.workspace_grid.actionMoveWorkspace.
         * For controlling scroll-direction, we have two options:
         *   1 - create two different handlers and choose the right one according
         * to the value of the "scroll-direction" option.
         *   2 - let the actionMoveWorkspace function do all the job.
         *
         * If we put the horizontal or vertical logic inside two different handlers,
         * there will be no way to other extensions use this feature.
         * They will have to implement their own handlers too. Because of it,
         * I decided that is better delegate all the necessary logic to the exported function.
         * So, now using a generic scroll handler (much like the original gnome-shell handler),
         * its possible to achieve the desired funcionality.
         *
         * This decision eventually made the code needed for integration with
         * other extensions very reduced.
         */
        function _scrollHandler(actor, event) {
            // same as the original, but for TOP/DOWN on grid
            let wsIndex = Utils.WS.getWS().get_active_workspace_index();

            switch (event.get_scroll_direction()) {
                case Clutter.ScrollDirection.UP:
                    Utils.WS.getWS().workspace_grid.actionMoveWorkspace(
                        Meta.MotionDirection.UP
                    );
                    return Clutter.EVENT_STOP;
                case Clutter.ScrollDirection.DOWN:
                    Utils.WS.getWS().workspace_grid.actionMoveWorkspace(
                        Meta.MotionDirection.DOWN
                    );
                    return Clutter.EVENT_STOP;
            }

            return Clutter.EVENT_PROPAGATE;
        }
    };

    // 2. Replace workspacesDisplay._thumbnailsBox with my own.
    // Start with controls collapsed (since the workspace thumbnails can take
    // up quite a bit of space horizontally). This will be recalculated
    // every time the overview shows.
    // NOTE: I usually create a new instance of ThumbnailsBox() (defined above)
    // and simply replace all references to the old thumbnailsBox with this one.
    // However, the old one listens to various signals (like Main.overview's
    // 'hidden' or 'showing') that modify the thumbnailsBox actor. Since these
    // signals' IDs are not stored by gnome-shell, I can't disconnect them
    // properly, and when the signals fire they attempt to modify the now
    // non-existent/non-mapped actor, causing segfaults.

    // I will submit a patch for this against gnome-shell
    // (note to self: see https://git.gnome.org/browse/gnome-shell/commit/?id=ee4f199a9ff9f302d01393c9b6b79a0a1680db8f
    //  for how it's done), but in the meantime:
    // The only way I know how to get around it is to *leave*
    // Main.overview._thumbnailsBox as-is, but *replace* its actor with my own
    // (connected to my own _getPreferred(Width|Height) and _allocate callbacks).
    //
    // It's really really ugly, but it is a workaround and it works until
    // I submit my patch and it eventually makes it into gnome-shell.

    // replace thumbnailsBox.actor with a new one
    let MyTBProto = ThumbnailsBox.prototype,
        thumbnailsBox = Main.overview._controls._thumbnailsBox;

    _replaceThumbnailsBoxActor(MyTBProto);

    // add in the properties/functions I want.
    thumbnailsBox._indicatorX = 0;
    // patch the dropPlaceholder to show a glow around the workspace being
    // dropped on rather than the "new workspace" indicator.
    thumbnailsBox._dropPlaceholder.style_class =
        "workspace-thumbnail-drop-indicator";

    tbStorage.handleDragOver = TBProto.handleDragOver;
    tbStorage._activeWorkspaceChanged = TBProto._activeWorkspaceChanged;

    TBProto.handleDragOver = MyTBProto.handleDragOver;
    TBProto._activeWorkspaceChanged = MyTBProto._activeWorkspaceChanged;
    TBProto.__defineGetter__(
        "indicatorX",
        MyTBProto.__lookupGetter__("indicatorX")
    );
    TBProto.__defineSetter__(
        "indicatorX",
        MyTBProto.__lookupSetter__("indicatorX")
    );

    // 3. Patch updateAlwaysZoom (now a function in OverviewControls as opposed
    //    to a property of workspaceDisplay)
    tbStorage._getAlwaysZoomOut =
        OverviewControls.ThumbnailsSlider.prototype._getAlwaysZoomOut;
    OverviewControls.ThumbnailsSlider.prototype._getAlwaysZoomOut = function() {
        // *Always* show the pager when hovering or during a drag, regardless of width.
        let alwaysZoomOut = this.actor.hover || this._inDrag;

        // always zoom out if there is a monitor to the right of primary.
        if (!alwaysZoomOut) {
            let monitors = Main.layoutManager.monitors;
            let primary = Main.layoutManager.primaryMonitor;

            /* Look for any monitor to the right of the primary, if there is
             * one, we always keep zoom out, otherwise its hard to reach
             * the thumbnail area without passing into the next monitor. */
            for (let i = 0; i < monitors.length; i++) {
                if (monitors[i].x >= primary.x + primary.width) {
                    alwaysZoomOut = true;
                    break;
                }
            }
        }

        // always zoom out if we are not too wide
        if (
            !alwaysZoomOut &&
            Main.overview._controls._thumbnailsBox.actor.mapped
        ) {
            alwaysZoomOut =
                Main.overview._controls._thumbnailsBox.actor.width <=
                Main.layoutManager.primaryMonitor.width *
                    settings.get_double(KEY_MAX_HFRACTION_COLLAPSE);
        }

        return alwaysZoomOut;
    };

    // finally refresh the box.
    refreshThumbnailsBox();
}

function unoverrideWorkspaceDisplay() {
    if (Main.overview.visible) {
        Main.overview.hide();
    }

    let wD = _getWorkspaceDisplay();
    // undo scroll event patching
    WorkspacesView.WorkspacesView.prototype._init = wvStorage._init;
    for (let i = 0; i < wD._workspacesViews.length; ++i) {
        let wV = wD._workspacesViews[i];
        if (wV._scrollHandler) {
            wV.disconnect(wV._scrollHandler);
        }
    }

    // 2. replace the thumbnails box actor
    // restore functions
    TBProto.handleDragOver = tbStorage.handleDragOver;
    TBProto._activeWorkspaceChanged = tbStorage._activeWorkspaceChanged;
    delete TBProto.indicatorX; // remove the getter/setter
    // replace the actor
    _replaceThumbnailsBoxActor(TBProto);
    let thumbnailsBox = Main.overview._controls._thumbnailsBox;
    thumbnailsBox._dropPlaceholder.style_class = "placeholder";
    delete thumbnailsBox._indicatorX;
    delete thumbnailsBox._maxHscale;

    // 3. Unpatch updateAlwaysZoom
    OverviewControls.ThumbnailsSlider.prototype._getAlwaysZoomOut =
        tbStorage._getAlwaysZoomOut;

    refreshThumbnailsBox();
}

/******************
 * Sets org.gnome.shell.overrides.dynamic-workspaces schema to false
 *******************/
function disableDynamicWorkspaces() {
    let settings;
    // Override schemas are gone in GNOME 3.30
    if (Utils.isVersionAbove(3, 28)) {
        settings = new Gio.Settings({ schema_id: "org.gnome.mutter" });
    } else {
        settings = global.get_overrides_settings();
    }
    settings.set_boolean("dynamic-workspaces", false);
}

/******************
 * tells Meta about the number of workspaces we want
 ******************/
function modifyNumWorkspaces() {
    /// Setting the number of workspaces.
    Meta.prefs_set_num_workspaces(
        Utils.WS.getWS().workspace_grid.rows *
            Utils.WS.getWS().workspace_grid.columns
    );

    /* NOTE: in GNOME 3.4, 3.6, 3.8, Meta.prefs_set_num_workspaces has
     * *no effect* if Meta.prefs_get_dynamic_workspaces is true.
     * (see mutter/src/core/screen.c prefs_changed_callback).
     * To *actually* increase/decrease the number of workspaces (to fire
     * notify::n-workspaces), we must use Utils.WS.getWS().append_new_workspace
     * and Utils.WS.getWS().remove_workspace.
     *
     * We could just set org.gnome.shell.overrides.dynamic-workspaces to false
     * but then we can't drag and drop windows between workspaces (supposedly a
     * GNOME 3.4 bug, see the Frippery Static Workspaces extension. Can confirm
     * but cannot find a relevant bug report/fix.)
     * Can confirm the bug in 3.6 too.
     * In 3.8 I appear to be able to drag/drop between workspace but not to
     * drag/drop to create new workspaces (with the placeholder animation),
     * so I'll stick to this method for now.
     */
    let newtotal =
        Utils.WS.getWS().workspace_grid.rows *
        Utils.WS.getWS().workspace_grid.columns;
    if (Utils.WS.getWS().n_workspaces < newtotal) {
        for (let i = Utils.WS.getWS().n_workspaces; i < newtotal; ++i) {
            Utils.WS.getWS().append_new_workspace(
                false,
                global.get_current_time()
            );
        }
    } else if (Utils.WS.getWS().n_workspaces > newtotal) {
        for (let i = Utils.WS.getWS().n_workspaces - 1; i >= newtotal; --i) {
            Utils.WS.getWS().remove_workspace(
                Utils.WS.getWS().get_workspace_by_index(i),
                global.get_current_time()
            );
        }
    }

    // This affects workspace.get_neighbor() (only exposed in 3.8+) and appears
    // to do not much else. We'll do it anyway just in case.
    Utils.WS.getWS().override_workspace_layout(
        Utils.WS.getCorner().TOPLEFT, // workspace 0
        false, // true == lay out in columns. false == lay out in rows
        Utils.WS.getWS().workspace_grid.rows,
        Utils.WS.getWS().workspace_grid.columns
    );

    // this forces the workspaces display to update itself to match the new
    // number of workspaces.
    Utils.WS.getWS().notify("n-workspaces");

    disableDynamicWorkspaces();
}

function unmodifyNumWorkspaces() {
    // restore original number of workspaces
    Meta.prefs_set_num_workspaces(nWorkspaces);

    Utils.WS.getWS().override_workspace_layout(
        Utils.WS.getCorner().TOPLEFT, // workspace 0
        true, // true == lay out in columns. false == lay out in rows
        nWorkspaces,
        1 // columns
    );
}

/******************
 * Store rows/cols of workspaces, convenience functions to
 * global.{screen,workspace_manager}.workspace_grid
 * such that if other extension authors want to they can use them.
 *
 * Exported constants:
 * rows     : number of rows of workspaces
 * columns  : number of columns of workspaces
 *
 * Exported functions:
 * rowColToIndex : converts the row/column into an index for use with (e.g.)
 *                 global.{screen,workspace_manager}.get_workspace_by_index(i)
 * indexToRowCol : converts an index (0 to
 *                 global.{screen,workspace_manager}.n_workspaces-1) to a row
 *                 and column
 * getWorkspaceSwitcherPopup : gets our workspace switcher popup so you
 *                             can show it if you want
 * calculateWorkspace : returns the workspace index in the specified direction
 *                      to the current, taking into account wrapping.
 * moveWorkspace : switches workspaces in the direction specified, being either
 *                 UP, LEFT, RIGHT or DOWN (see Meta.MotionDirection).
 ******************/
function exportFunctionsAndConstants() {
    Utils.WS.getWS().workspace_grid = {
        rows: settings.get_int(KEY_ROWS),
        columns: settings.get_int(KEY_COLS),

        rowColToIndex: rowColToIndex,
        indexToRowCol: indexToRowCol,
        getWorkspaceSwitcherPopup: getWorkspaceSwitcherPopup,
        calculateWorkspace: calculateWorkspace,
        moveWorkspace: moveWorkspace,
        actionMoveWorkspace: actionMoveWorkspace,
        actionMoveWindow: actionMoveWindow
    };

    // It seems you can only have 36 workspaces max.
    if (
        settings.get_int(KEY_ROWS) * settings.get_int(KEY_COLS) >
        MAX_WORKSPACES
    ) {
        log(
            "WARNING [workspace-grid]: You can have at most 36 workspaces, " +
                "will ignore the rest"
        );
        Utils.WS.getWS().workspace_grid.rows = Math.ceil(
            MAX_WORKSPACES / Utils.WS.getWS().workspace_grid.columns
        );
    }
}

function unexportFunctionsAndConstants() {
    delete Utils.WS.getWS().workspace_grid;
}

/***************************
 *         EXTENSION       *
 ***************************/

function init() {}

function nWorkspacesChanged() {
    // re-export new rows/cols
    exportFunctionsAndConstants();
    // reset the number of workspaces
    modifyNumWorkspaces();
}

let signals = [];
function enable() {
    /// Storage
    nWorkspaces = Meta.prefs_get_num_workspaces();
    settings = Convenience.getSettings();

    //    makeWorkspacesStatic();
    exportFunctionsAndConstants(); // so other extension authors can use.
    overrideKeybindingsAndPopup();
    overrideWorkspaceDisplay();
    // Main.start() gets in one call to _nWorkspacesChanged that appears to
    // be queued before any extensions enabled (so my subsequent patching
    // doesn't do anything), but takes affect *after* my `modifyNumWorkspaces`
    // call, killing all the extra workspaces I just added...
    // So we wait a little bit before caling.
    Mainloop.idle_add(modifyNumWorkspaces);

    // Connect settings change: the only one we have to monitor is cols/rows
    signals.push(
        settings.connect(
            "changed::" + KEY_ROWS,
            nWorkspacesChanged
        )
    );
    signals.push(
        settings.connect(
            "changed::" + KEY_COLS,
            nWorkspacesChanged
        )
    );
    signals.push(
        settings.connect(
            "changed::" + KEY_MAX_HFRACTION,
            refreshThumbnailsBox
        )
    );
    signals.push(
        settings.connect(
            "changed::" + KEY_MAX_HFRACTION_COLLAPSE,
            refreshThumbnailsBox
        )
    );
}

function disable() {
    unoverrideWorkspaceDisplay();
    unoverrideKeybindingsAndPopup();
    unmodifyNumWorkspaces();
    unexportFunctionsAndConstants();
    //    unmakeWorkspacesStatic();

    let i = signals.length;
    while (i--) {
        settings.disconnect(signals.pop());
    }

    // just in case, let everything else get used to the new number of
    // workspaces.
    Utils.WS.getWS().notify("n-workspaces");
}
