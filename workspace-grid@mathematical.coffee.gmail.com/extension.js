/*global global, log */ // <-- jshint
/*jshint unused: true, maxlen: 150 */
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
 * global.screen.workspace_grid for your convenience. Note that this extension
 * must be enabled for this all to work. global.screen.workspace_grid contains:
 *
 *   (Exported Constants)
 *   - Directions = { UP, LEFT, RIGHT, DOWN } : directions for navigating (see
 *                                              moveWorkspaces further down)
 *     (NOTE: for 3.6+ you can just use Meta.MotionDirection.{UP,LEFT,RIGHT,DOWN})
 *   - rows     : number of rows of workspaces
 *   - columns  : number of columns of workspaces
 *
 *   (Exported Functions)
 *   - moveWorkspace : switches workspaces in the direction specified, being
 *                     either UP, LEFT, RIGHT or DOWN (see Directions).
 *   - rowColToIndex : converts the row/column into an index for use with (e.g.)
 *                     global.screen.get_workspace_by_index(i)
 *   - indexToRowCol : converts an index (0 to global.screen.n_workspaces-1) to
 *                     a row and column
 *   - getWorkspaceSwitcherPopup : gets our workspace switcher popup so you
 *                                 can show it if you want
 *   - calculateWorkspace : returns the workspace index in the specified direction
 *                          to the current, taking into account wrapping.
 *
 * For example, to move to the workspace below us:
 *     const WorkspaceGrid = global.screen.workspace_grid;
 *     WorkspaceGrid.moveWorkspace(WorkspaceGrid.Directions.DOWN);
 *
 * I am happy to try help/give an opinion/improve this extension to try make it
 *  more compatible with yours, email me :)
 *
 * Listening to workspace_grid
 * ---------------------------
 * Say you want to know the number of rows/columns of workspaces in your
 * extension. Then you have to wait for this extension to load and populate
 * global.screen.workspace_grid.
 *
 * When the workspace_grid extension enables or disables it fires a
 *  'notify::n_workspaces' signal on global.screen.
 *
 * You can connect to this and check for the existence (or removal) of
 * global.screen.workspace_grid.
 *
 * Further notes
 * -------------
 * Workspaces can be changed by the user by a number of ways, and this extension
 * aims to cover them all:
 * - keybinding (wm.setKeybindingHandler)
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
 *   We wrap around to the *same* row/column (if KEY_WRAPAROUND is true)
 * - no need to reconstruct workspace controls (I think)
 */

////////// CODE ///////////
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const DND = imports.ui.dnd;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;
const WorkspaceSwitcher = imports.ui.workspaceSwitcherPopup;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;
const WorkspacesView = imports.ui.workspacesView;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Prefs = Me.imports.prefs;

const KEY_ROWS = Prefs.KEY_ROWS;
const KEY_COLS = Prefs.KEY_COLS;
const KEY_WRAPAROUND = Prefs.KEY_WRAPAROUND;
const KEY_WRAP_TO_SAME = Prefs.KEY_WRAP_TO_SAME;
const KEY_MAX_HFRACTION = Prefs.KEY_MAX_HFRACTION;
const KEY_MAX_HFRACTION_COLLAPSE = Prefs.KEY_MAX_HFRACTION_COLLAPSE;
const KEY_SHOW_WORKSPACE_LABELS = Prefs.KEY_SHOW_WORKSPACE_LABELS;

// laziness
const UP = Meta.MotionDirection.UP;
const DOWN = Meta.MotionDirection.DOWN;
const LEFT = Meta.MotionDirection.LEFT;
const RIGHT = Meta.MotionDirection.RIGHT;
const BindingToDirection = {
    'switch-to-workspace-up': UP,
    'switch-to-workspace-down': DOWN,
    'switch-to-workspace-left': LEFT,
    'switch-to-workspace-right': RIGHT,
    'move-to-workspace-up': UP,
    'move-to-workspace-down': DOWN,
    'move-to-workspace-left': LEFT,
    'move-to-workspace-right': RIGHT
};
/* it seems the max number of workspaces is 36
 * (MAX_REASONABLE_WORKSPACES in mutter/src/core/prefs.c)
 */
const MAX_WORKSPACES = 36;

/* Import some constants from other files and also some laziness */
const MAX_THUMBNAIL_SCALE = WorkspaceThumbnail.MAX_THUMBNAIL_SCALE;
const WORKSPACE_CUT_SIZE = WorkspaceThumbnail.WORKSPACE_CUT_SIZE;
const ThumbnailState = WorkspaceThumbnail.ThumbnailState;
const WMProto = WindowManager.WindowManager.prototype;

/* storage for the extension */
let staticWorkspaceStorage = {};
let wmStorage = {};
let wvStorage = {};
let nWorkspaces;
let _workspaceSwitcherPopup = null;
let thumbnailsBox = null;
let onScrollId = 0;
let settings = 0;

/***************
 * Helper functions
 ***************/
/* Converts an index (from 0 to global.screen.n_workspaces) into [row, column]
 * being the row and column of workspace `index` according to the user's layout.
 *
 * Row and column start from 0.
 */
function indexToRowCol(index) {
    // row-major. 0-based.
    return [Math.floor(index / global.screen.workspace_grid.columns),
       index % global.screen.workspace_grid.columns];
}

/* Converts a row and column (0-based) into the index of that workspace.
 *
 * If the resulting index is greater than MAX_WORKSPACES (the maximum number
 * of workspaces allowable by Mutter), it will return -1.
 */
function rowColToIndex(row, col) {
    // row-major. 0-based.
    let idx = row * global.screen.workspace_grid.columns + col;
    if (idx >= MAX_WORKSPACES) {
        idx = -1;
    }
    return idx;
}

/** Gets the workspace switcher popup, creating if it doesn't exist. */
function getWorkspaceSwitcherPopup() {
    if (!_workspaceSwitcherPopup) {
        _workspaceSwitcherPopup = new WorkspaceSwitcherPopup();
        // just in case.
        Main.wm._workspaceSwitcherPopup = _workspaceSwitcherPopup;
        // in GNOME 3.6 instead of storing the popup for next time, it's
        // destroyed every single time it fades out..
        _workspaceSwitcherPopup.connect('destroy', function () {
            _workspaceSwitcherPopup = null;
            Main.wm._workspaceSwitcherPopup = null;
        });
    }
    return _workspaceSwitcherPopup;
}

// calculates the workspace index in that direction.
function calculateWorkspace(direction, wraparound, wrapToSame) {
    let from = global.screen.get_active_workspace(),
        to = from.get_neighbor(direction).index();

    if (!wraparound || from.index() !== to) {
        return to;
    }

    // otherwise, wraparound is TRUE and from === to (we are at the edge)
    let [row, col] = indexToRowCol(from.index());
    switch (direction) {
        case LEFT:
            // we must be at the start of the row. go to the end of the row.
            col = global.screen.workspace_grid.columns - 1;
            if (!wrapToSame) row--;
            break;
        case RIGHT:
            // we must be at the end of the row. go to the start of the same row.
            col = 0;
            if (!wrapToSame) row++;
            break;
        case UP:
            // we must be at the top of the col. go to the bottom of the same col.
            row = global.screen.workspace_grid.rows - 1;
            if (!wrapToSame) col--;
            break;
        case DOWN:
            // we must be at the bottom of the col. go to the top of the same col.
            row = 0;
            if (!wrapToSame) col++;
            break;
    }
    if (col < 0 || row < 0) {
        to = global.screen.n_workspaces - 1;
    } else if (col > global.screen.workspace_grid.columns - 1 ||
               row > global.screen.workspace_grid.rows - 1) {
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
 * - keybinding (wm.setKeybindingHandler)
 * - keybinding with global grab in progress (e.g. Overview/lg)
 * - scrolling/clicking in the overview
 * - (other extensions, e.g. navigate with up/down arrows:
 *        https://extensions.gnome.org/extension/29/workspace-navigator/)
 */
function moveWorkspace(direction) {
    Main.wm.actionMoveWorkspace(direction);

    // show workspace switcher
    if (!Main.overview.visible) {
        getWorkspaceSwitcherPopup().display(direction, to);
    }
}

// GNOME 3.6: _redraw --> _redisplay
/************
 * Workspace Switcher that can do rows and columns as opposed to just rows.
 ************/
const WorkspaceSwitcherPopup = new Lang.Class({
    Name: 'WorkspaceSwitcherPopup',
    Extends: WorkspaceSwitcher.WorkspaceSwitcherPopup,

    // note: this makes sure everything fits vertically and then adjust the
    // horizontal to fit.
    _getPreferredHeight : function (actor, forWidth, alloc) {
        let children = this._list.get_children(),
            primary = Main.layoutManager.primaryMonitor,
            nrows = global.screen.workspace_grid.rows,
            availHeight = primary.height,
            height = 0,
            spacing = this._itemSpacing * (nrows - 1);

        availHeight -= Main.panel.actor.height;
        availHeight -= this.actor.get_theme_node().get_vertical_padding();
        availHeight -= this._container.get_theme_node().get_vertical_padding();
        availHeight -= this._list.get_theme_node().get_vertical_padding();

        for (let i = 0; i < global.screen.n_workspaces;
                i += global.screen.workspace_grid.columns) {
            let [childMinHeight, childNaturalHeight] =
                children[i].get_preferred_height(-1);
            children[i].get_preferred_width(childNaturalHeight);
            height += childNaturalHeight * primary.width / primary.height;
        }

        height += spacing;

        height = Math.min(height, availHeight);
        this._childHeight = (height - spacing) / nrows;

        // check for horizontal overflow and adjust.
        let childHeight = this._childHeight;
        this._getPreferredWidth(actor, -1, {});
        if (childHeight !== this._childHeight) {
            // the workspaces will overflow horizontally and ._childWidth &
            // ._childHeight have been adjusted to make it fit.
            height = this._childHeight * nrows + spacing;
            if (height > availHeight) {
                this._childHeight = (availHeight - spacing) / nrows;
            }
        }

        alloc.min_size = height;
        alloc.natural_size = height;
    },

    _getPreferredWidth : function (actor, forHeight, alloc) {
        let primary = Main.layoutManager.primaryMonitor,
            ncols = global.screen.workspace_grid.columns;
        this._childWidth = this._childHeight * primary.width / primary.height;
        let width = this._childWidth * ncols + this._itemSpacing * (ncols - 1),
            padding = this.actor.get_theme_node().get_horizontal_padding() +
                      this._list.get_theme_node().get_horizontal_padding() +
                      this._container.get_theme_node().get_horizontal_padding();

        // but constrain to at most primary.width
        if (width + padding > primary.width) {
            this._childWidth = (primary.width - padding -
                                this._itemSpacing * (ncols - 1)) / ncols;
            this._childHeight = this._childWidth * primary.height /
                                primary.width;
            width = primary.width - padding;
        }

        alloc.min_size = width;
        alloc.natural_size = width;
    },

    _allocate : function (actor, box, flags) {
        let children = this._list.get_children(),
            childBox = new Clutter.ActorBox(),
            x = box.x1,
            y = box.y1,
            prevX = x,
            prevY = y,
            i = 0;
        for (let row = 0; row < global.screen.workspace_grid.rows; ++row) {
            x = box.x1;
            prevX = x;
            for (let col = 0; col < global.screen.workspace_grid.columns; ++col) {
                childBox.x1 = prevX;
                childBox.x2 = Math.round(x + this._childWidth);
                childBox.y1 = prevY;
                childBox.y2 = Math.round(y + this._childHeight);

                x += this._childWidth + this._itemSpacing;
                prevX = childBox.x2 + this._itemSpacing;
                children[i].allocate(childBox, flags);
                i++;
                if (i >= MAX_WORKSPACES) {
                    break;
                }
            }
            if (i >= MAX_WORKSPACES) {
                break;
            }
            prevY = childBox.y2 + this._itemSpacing;
            y += this._childHeight + this._itemSpacing;
        }
    },

    // GNOME 3.6: old _redraw + _position is now combined into _redisplay
    // Also, workspace switcher is *destroyed* whenever it fades out.
    // Previously it was stored.
    _redisplay: function () {
        //log('redisplay, direction ' + this._direction + ', going to ' + this._activeWorkspaceIndex);
        this._list.destroy_all_children();

        for (let i = 0; i < global.screen.n_workspaces; i++) {
            let indicator = null;
            let name = Meta.prefs_get_workspace_name(i);

            if (i === this._activeWorkspaceIndex &&
                   this._direction === UP) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-up'
                });
            } else if (i === this._activeWorkspaceIndex &&
                   this._direction === DOWN) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-down'
                });
            } else if (i === this._activeWorkspaceIndex &&
                   this._direction === LEFT) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-left'
                });
            } else if (i === this._activeWorkspaceIndex &&
                   this._direction === RIGHT) {
                indicator = new St.Bin({
                    style_class: 'ws-switcher-active-right'
                });
            } else {
                indicator = new St.Bin({style_class: 'ws-switcher-box'});
            }
            if (settings.get_boolean(KEY_SHOW_WORKSPACE_LABELS) && i !== this._activeWorkspaceIndex) {
                indicator.child = new St.Label({
                    text: name,
                    style_class: 'ws-switcher-label'
                });
            }

            this._list.add_actor(indicator);
        }

        let primary = Main.layoutManager.primaryMonitor;
        let [containerMinHeight, containerNatHeight] = this._container.get_preferred_height(global.screen_width);
        let [containerMinWidth, containerNatWidth] = this._container.get_preferred_width(containerNatHeight);
        this._container.x = primary.x + Math.floor((primary.width - containerNatWidth) / 2);
        this._container.y = primary.y + Main.panel.actor.height +
                            Math.floor(((primary.height - Main.panel.actor.height) - containerNatHeight) / 2);
    }

});

/* Keybinding handler.
 * Should bring up a workspace switcher.
 * Either activates the target workspace or if it's move-to-workspace-xxx
 * we should move the window as well as show the workspace switcher.
 * This is the same as WindowManager._showWorkspaceSwitcher but we don't
 * filter out RIGHT/LEFT actions like they do.
 */
function showWorkspaceSwitcher(display, screen, window, binding) {
    if (global.screen.n_workspaces === 1)
        return;

    let direction = BindingToDirection[binding.get_name()],
        to;
    if (binding.get_name().substr(0, 5) === 'move-') {
        // we've patched this
        to = Main.wm.actionMoveWindow(window, direction);
    } else {
        // we've patched this
        to = Main.wm.actionMoveWorkspace(direction);
    }

    // show workspace switcher
    if (!Main.overview.visible) {
        getWorkspaceSwitcherPopup().display(direction, to.index());
    }
}

/******************
 * Overrides the 'switch_to_workspace_XXX' keybindings
 * Relevant code in js/windowManager.js
 ******************/
function overrideKeybindingsAndPopup() {
    // note - we could simply replace Main.wm._workspaceSwitcherPopup and
    // not bother with taking over the keybindings, if not for the 'wraparound'
    // stuff.
    let bindings = Object.keys(BindingToDirection);
    for (let i = 0; i < bindings.length; ++i) {
        Main.wm.setCustomKeybindingHandler(bindings[i],
                                           Shell.KeyBindingMode.NORMAL |
                                           Shell.KeyBindingMode.OVERVIEW,
                                           showWorkspaceSwitcher);
	}

    // Override imports.ui.windowManager.actionMove* just in case other
    // extensions use them.
    wmStorage.actionMoveWorkspace = WMProto.actionMoveWorkspace;
    WMProto.actionMoveWorkspace = function (direction) {
        let from = global.screen.get_active_workspace_index(),
            to = calculateWorkspace(direction,
                    settings.get_boolean(KEY_WRAPAROUND),
                    settings.get_boolean(KEY_WRAP_TO_SAME)),
            ws = global.screen.get_workspace_by_index(to);

        if (to !== from) {
            ws.activate(global.get_current_time());
        }
        return ws;
    };
    wmStorage.actionMoveWindow = WMProto.actionMoveWindow;
    WMProto.actionMoveWindow = function (window, direction) {
        let to = calculateWorkspace(direction,
                settings.get_boolean(KEY_WRAPAROUND),
                settings.get_boolean(KEY_WRAP_TO_SAME)),
            ws = global.screen.get_workspace_by_index(to);

        if (to !== global.screen.get_active_workspace_index()) {
            Main.wm._movingWindow = window;
            window.change_workspace(ws);
            global.display.clear_mouse_mode();
            ws.activate_with_focus(window, global.get_current_time());
        }
        return ws;
    };
}

/* Restore the original keybindings */
function unoverrideKeybindingsAndPopup() {
    let bindings = Object.keys(BindingToDirection);
    for (let i = 0; i < bindings.length; ++i) {
        Main.wm.setCustomKeybindingHandler(bindings[i],
                                               Shell.KeyBindingMode.NORMAL |
                                               Shell.KeyBindingMode.OVERVIEW,
                                               Lang.bind(Main.wm,
                                                   Main.wm._showWorkspaceSwitcher));
    }

    _workspaceSwitcherPopup = null;

    WMProto.actionMoveWorkspace = wmStorage.actionMoveWorkspace;
    WMProto.actionMoveWindow = wmStorage.actionMoveWindow;
}

// GNOME 3.2 & 3.4: Main.overview._workspacesDisplay
// GNOME 3.6, 3.8: Main.overview._viewSelector._workspacesDisplay
function _getWorkspaceDisplay() {
    return Main.overview._workspacesDisplay || Main.overview._viewSelector._workspacesDisplay;
}

/******************
 * Overrides the workspaces display in the overview
 ******************/
const ThumbnailsBox = new Lang.Class({
    Name: 'ThumbnailsBox',
    Extends: WorkspaceThumbnail.ThumbnailsBox,

    /**
     * The following are overridden simply to incorporate ._indicatorX in the
     * same way as ._indicatorY
     **/
    _init: function () {
        // Note: we could just call this.parent(); this._inicatorX = 0; but
        // instead we replicate this.parent()'s code here so we can store
        // the signal IDs (it connects to Main.overview) so that we can delete
        // them properly on destroy!

        // In contradiction to the comment above (no signal ids stored...)::
        // TODO: pick one way or the other (once confirmed working)
        this.parent();

        this._indicatorX = 0; // to match indicatorY
        this._dropPlaceholderHorizontal = true;
    },

    /* when the user clicks on a thumbnail take into account the x position
     * of that thumbnail as well as the y to determine which was clicked */
    _onButtonRelease: function (actor, event) {
        // @@
        log("BUTTON RELEASE");
        let [stageX, stageY] = event.get_coords();
        let [r, x, y] = this.actor.transform_stage_point(stageX, stageY);

        for (let i = 0; i < this._thumbnails.length; i++) {
            let thumbnail = this._thumbnails[i];
            let [w, h] = thumbnail.actor.get_transformed_size();
            // add in the x criteria
            if (y >= thumbnail.actor.y && y <= thumbnail.actor.y + h &&
                    x >= thumbnail.actor.x && x <= thumbnail.actor.x + w) {
                log(" f");
                log(this._indicator.mapped); // true...
                thumbnail.activate(event.get_time()); // <- SEGFAULT HERE
		// WORKED IT OUT: the old thumbnailsbox is not properly dead-  activeWorkspaceChanged
		//  is still triggering on the *old* one which I destroyed (i thought!!!)
                // TODO UPTO
                // OK the above calls this.metaWorkspace.activate() and it is this that
                // causes the segfault
                // i think some sort of allocate call is being made as the
                // slider hides which calls perhaps _redraw which is causing it.
                // NOPE it's not from _allocate (I think)

                // st_widget_get_theme_node called on widget which is not on the stage
                // it is the _indicator that appears to trigger this. Even though it is mapped.
                log(" g");
                break;
            }
        }

        return true;
    },

    /* with drag and drop: modify to look at the x direction as well as the y */
    handleDragOver: function (source, actor, x, y, time) {
        if (!source.realWindow && !source.shellWorkspaceLaunch &&
                source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        if (!Meta.prefs_get_dynamic_workspaces())
            return DND.DragMotionResult.CONTINUE;

        let targetBaseX,
            targetBaseY,
            spacing = this.actor.get_theme_node().get_length('spacing'),
            placeholderPos = -1,
            placeholderOrient = -1;

        this._dropWorkspace = -1;
        if (this._dropPlaceholderPos === 0) {
            targetBaseY = this._dropPlaceholder.y;
        } else {
            targetBaseY = this._thumbnails[0].actor.y;
        }
        let targetTop = targetBaseY - spacing - WORKSPACE_CUT_SIZE;
        let targetBottom, nextTargetBaseY, nextTargetTop, targetLeft;

        for (let i = 0; i < this._thumbnails.length; i++) {
            // Allow the reorder target to have a 10px "cut" into
            // each side of the thumbnail, to make dragging onto the
            // placeholder easier
            let [row, col] = indexToRowCol(i),
                [w, h] = this._thumbnails[i].actor.get_transformed_size();
            if (col === 0) { // new row.
                // 1) reset X targets to col 0
                if (this._dropPlaceholderPos === 0) {
                    targetBaseX = this._dropPlaceholder.x;
                } else {
                    targetBaseX = this._thumbnails[0].actor.x;
                }
                targetLeft = targetBaseX - spacing - WORKSPACE_CUT_SIZE;

                // 2) increment Y targets
                if (row > 0) {
                    targetBaseY = nextTargetBaseY;
                    targetTop = nextTargetTop; // THESE ARE GOING WRONG
                }
                targetBottom = targetBaseY + WORKSPACE_CUT_SIZE;
                nextTargetBaseY = targetBaseY + h + spacing;
                nextTargetTop = nextTargetBaseY - spacing -
                    ((row === global.screen.workspace_grid.rows - 1) ? 0 :
                         WORKSPACE_CUT_SIZE);
            }
            let targetRight = targetBaseX + WORKSPACE_CUT_SIZE,
                nextTargetBaseX = targetBaseX + w + spacing,
                nextTargetLeft =  nextTargetBaseX - spacing -
                    ((col === global.screen.workspace_grid.cols - 1) ? 0 :
                         WORKSPACE_CUT_SIZE);

            // Expand the target to include the placeholder, if it exists.
            if (i === this._dropPlaceholderPos) {
                // have to guard against the -1 case...
                if (this._dropPlaceholderHorizontal === true) {
                    targetBottom += this._dropPlaceholder.get_height();
                } else if (this._dropPlaceholderHorizontal === false) {
                    targetRight += this._dropPlaceholder.get_width();
                }
            }

            /*
            log('target area for workspace %d (%d, %d):\n  horizontal (%d, %d) to (%d, %d)\n  vertical (%d, %d) to (%d, %d)'.format(
                        i, row, col,
                        targetBaseX, targetTop, targetBaseX + w, targetBottom,
                        targetLeft, targetBaseY, targetRight, targetBaseY + h
                        ));
            */
            if (y > targetTop && y <= targetBottom &&
                    x >= targetBaseX && x <= (targetBaseX + w) &&
                    source !== Main.xdndHandler) {
                // workspace is placed
                placeholderPos = i;
                placeholderOrient = true;
                break;
            } else if (x > targetLeft && x <= targetRight &&
                    y >= targetBaseY && y <= (targetBaseY + h) &&
                    source !== Main.xdndHandler) {
                placeholderPos = i;
                placeholderOrient = false;
                break;
            } else if (y > targetBottom && y <= nextTargetTop &&
                    x > targetLeft && x <= nextTargetLeft) {
                this._dropWorkspace = i;
                break;
            }

            targetBaseX = nextTargetBaseX;
            targetLeft = nextTargetLeft;
        }

        if (this._dropPlaceholderPos !== placeholderPos ||
            (placeholderOrient !== -1 &&
                 this._dropPlaceholderHorizontal !== placeholderOrient)) {
            this._dropPlaceholderPos = placeholderPos;
            this._dropPlaceholderHorizontal = placeholderOrient;
            if (this._dropPlaceholderHorizontal &&
                    this._dropPlaceholder.has_style_class_name('placeholder-vertical')) {
                this._dropPlaceholder.style_class = 'placeholder';
            } else if (!this._dropPlaceholderHorizontal &&
                    this._dropPlaceholder.has_style_class_name('placeholder')) {
                this._dropPlaceholder.style_class = 'placeholder-vertical';
            }
            this.actor.queue_relayout();
        }

        if (this._dropWorkspace !== -1)
            return this._thumbnails[this._dropWorkspace].handleDragOverInternal(
                    source, time);
        else if (this._dropPlaceholderPos !== -1)
            return source.realWindow ? DND.DragMotionResult.MOVE_DROP :
                DND.DragMotionResult.COPY_DROP;
        else
            return DND.DragMotionResult.CONTINUE;
    },

    /* stuff to do with the indicator around the current workspace */
    set indicatorX(indicatorX) {
        log('set indicatorX');
        this._indicatorX = indicatorX;
        //this.actor.queue_relayout(); // <-- we only ever change indicatorX
        // when we change indicatorY and that already causes a queue_relayout
        // so we omit it here so as not to have double the relayout requests..
    },

    get indicatorX() {
        log('get indicatorX');
        return this._indicatorX;
    },

    _activeWorkspaceChanged: function () {
        log('activeworkspacechanged');
        let thumbnail;
        let activeWorkspace = global.screen.get_active_workspace();
        for (let i = 0; i < this._thumbnails.length; i++) {
            if (this._thumbnails[i].metaWorkspace === activeWorkspace) {
                thumbnail = this._thumbnails[i];
                break;
            }
        }

        this._animatingIndicator = true;
        this.indicatorY = this._indicator.allocation.y1;
        this.indicatorX = this._indicator.allocation.x1; // <-- added
        Tweener.addTween(this,
                         { indicatorY: thumbnail.actor.allocation.y1,
                           indicatorX: thumbnail.actor.allocation.x1, // added
                           time: WorkspacesView.WORKSPACE_SWITCH_TIME,
                           transition: 'easeOutQuad',
                           onComplete: function () {
                                this._animatingIndicator = false;
                                this._queueUpdateStates();
                            },
                           onCompleteScope: this
                         });
    },

    /**
     * The following are to get things to layout in a grid
     * Note: the mode is WIDTH_FOR_HEIGHT, and we make sure that the box is
     * no wider than MAX_SCREEN_HFRACTION fraction of the screen width wide.
     * If it is wider than MAX_SCREEN_HFRACTION_COLLAPSE then we initially
     * start the thumbnails box collapsed.
     **/
    _getPreferredHeight: function (actor, forWidth, alloc) {
        let themeNode = this._background.get_theme_node();
        forWidth = themeNode.adjust_for_width(forWidth);

        if (this._thumbnails.length === 0) {
            return;
        }

        let spacing = this.actor.get_theme_node().get_length('spacing'),
            nRows = global.screen.workspace_grid.rows,
            totalSpacing = (nRows - 1) * spacing,
            height = totalSpacing + nWorkspaces * this._porthole.height *
                MAX_THUMBNAIL_SCALE;

        [alloc.min_size, alloc.natural_size] =
            themeNode.adjust_preferred_height(height, height);

    },

    _getPreferredWidth: function (actor, forHeight, alloc) {
        if (this._thumbnails.length === 0) {
            return;
        }

        let themeNode = this._background.get_theme_node(),
            spacing = this.actor.get_theme_node().get_length('spacing'),
            nRows = global.screen.workspace_grid.rows,
            nCols = global.screen.workspace_grid.columns,
            totalSpacingX = (nCols - 1) * spacing,
            totalSpacingY = (nRows - 1) * spacing,
            availY = forHeight - totalSpacingY,
            //scale = (availY / nRows) / this._porthole.height;
            scale = (availY < 0 ? MAX_THUMBNAIL_SCALE :
                    (availY / nRows) / this._porthole.height);

        // 'scale' is the scale we need to fit `nRows` of workspaces in the
        // available height (after taking into account padding).
        scale = Math.min(scale, MAX_THUMBNAIL_SCALE);

        let width = totalSpacingX + nCols * this._porthole.width * scale,
            maxWidth = (Main.layoutManager.primaryMonitor.width *
                            settings.get_double(KEY_MAX_HFRACTION)) -
                       this.actor.get_theme_node().get_horizontal_padding() -
                       themeNode.get_horizontal_padding();

        width = Math.min(maxWidth, width);

        // If the thumbnails box is "too wide" (see
        //  MAX_SCREEN_HFRACTION_BEFORE_COLLAPSE), then we should always
        //  collapse the workspace thumbnails by default.
        _getWorkspaceDisplay()._alwaysZoomOut = (width <=
                (Main.layoutManager.primaryMonitor.width *
                 settings.get_double(KEY_MAX_HFRACTION_COLLAPSE)));

        // natural width is nCols of workspaces + (nCols-1)*spacingX
        [alloc.min_size, alloc.natural_size] =
            themeNode.adjust_preferred_width(width, width);
    },

    _allocate: function (actor, box, flags) {
        log('_allocate');
        if (this._thumbnails.length === 0) // not visible
            return;

        log('_allocate 2');
        let rtl = (Clutter.get_default_text_direction() ===
                Clutter.TextDirection.RTL),
        // See comment about this._background in _init()
            themeNode = this._background.get_theme_node(),
            contentBox = themeNode.get_content_box(box),
            portholeWidth = this._porthole.width,
            portholeHeight = this._porthole.height,
            spacing = this.actor.get_theme_node().get_length('spacing'),
        // Compute the scale we'll need once everything is updated
            nCols = global.screen.workspace_grid.columns,
            nRows = global.screen.workspace_grid.rows,
            totalSpacingY = (nRows - 1) * spacing,
            totalSpacingX = (nCols - 1) * spacing,
            availX = (contentBox.x2 - contentBox.x1) - totalSpacingX,
            availY = (contentBox.y2 - contentBox.y1) - totalSpacingY;

        // work out what scale we need to squeeze all the rows/cols of
        // workspaces in
        let newScale = Math.min((availX / nCols) / portholeWidth,
                            (availY / nRows) / portholeHeight,
                            MAX_THUMBNAIL_SCALE);

        if (newScale !== this._targetScale) {
            if (this._targetScale > 0) {
                // We don't do the tween immediately because we need to observe
                // the ordering in queueUpdateStates - if workspaces have been
                // removed we need to slide them out as the first thing.
                this._targetScale = newScale;
                this._pendingScaleUpdate = true;
            } else {
                this._targetScale = this._scale = newScale;
            }

            this._queueUpdateStates();
        }

        let thumbnailHeight = portholeHeight * this._scale,
            thumbnailWidth = portholeWidth * this._scale,
            roundedHScale = Math.round(thumbnailWidth) / portholeWidth,
            roundedVScale = Math.round(thumbnailHeight) / portholeHeight;

        let slideOffset; // X offset when thumbnail is fully slid offscreen
        // (animate sliding that column onto screen)
        if (rtl)
            slideOffset = -thumbnailWidth + themeNode.get_padding(St.Side.LEFT);
        else
            slideOffset = thumbnailWidth + themeNode.get_padding(St.Side.RIGHT);

        let childBox = new Clutter.ActorBox();

        // Don't understand workspaceThumbnail.js here - I just cover the
        // entire allocation?
        this._background.allocate(box, flags);
        // old: box.x1 = box.x1 + (contentBox.x2-contentBox.x1) - thumbnailWid

        let indicatorY = this._indicatorY,
            indicatorX = this._indicatorX;
        // when not animating, the workspace position overrides this._indicatorY
        let indicatorWorkspace = !this._animatingIndicator ?
            global.screen.get_active_workspace() : null;

        // position roughly centred vertically: start at y1 + (backgroundHeight
        //  - thumbnailsHeights)/2
        let y = contentBox.y1 + (availY - (nRows * thumbnailHeight)) / 2,
            x = contentBox.x1,
            i = 0,
            thumbnail;

        if (this._dropPlaceholderPos === -1) {
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
                function () {
                    this._dropPlaceholder.hide();
                }));
        }

        for (let row = 0; row < global.screen.workspace_grid.rows; ++row) {
            x = contentBox.x1;
            for (let col = 0; col < global.screen.workspace_grid.columns; ++col) {
                thumbnail = this._thumbnails[i];

                // NOTE: original ThumbnailsBox does a lot of intricate calcul-
                // ations to do with rounding to make sure everything's evenly
                // spaced; we don't bother because I'm not smart enough to work
                // it out (so the spacing on the left might be a few pixels
                // more than that on the right).
                let x1 = x,
                    y1 = y;

                if (thumbnail.slidePosition !== 0) {
                    if (rtl) {
                        x1 -= slideOffset * thumbnail.slidePosition;
                    } else {
                        x1 += slideOffset * thumbnail.slidePosition;
                    }
                }

                if (i === this._dropPlaceholderPos) {
                    if (this._dropPlaceholderHorizontal) {
                        let [minHeight, placeholderHeight] =
                            this._dropPlaceholder.get_preferred_height(-1);
                        childBox.x1 = x1;
                        childBox.x2 = x1 + thumbnailWidth;
                        childBox.y1 = y;
                        childBox.y2 = y + placeholderHeight;

                        y1 += placeholderHeight + spacing;
                    } else {
                        let [minWidth, placeholderWidth] =
                            this._dropPlaceholder.get_preferred_width(-1);
                        childBox.x1 = x1;
                        childBox.x2 = x1 + placeholderWidth;
                        childBox.y1 = y;
                        childBox.y2 = y + thumbnailHeight;

                        x += placeholderWidth + spacing;
                        x1 += placeholderWidth + spacing;
                    }
                    this._dropPlaceholder.allocate(childBox, flags);
                    Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
                        function () {
                            this._dropPlaceholder.show();
                        }));
                }

                if (thumbnail.metaWorkspace === indicatorWorkspace) {
                    indicatorY = y1;
                    indicatorX = x1;
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

                x += thumbnailWidth - thumbnailWidth *
                    thumbnail.collapseFraction;

                // add spacing
                x += spacing - thumbnail.collapseFraction * spacing;

                ++i;
                if (i >= MAX_WORKSPACES) {
                    break;
                }
            }
            y += thumbnailHeight - thumbnailHeight * thumbnail.collapseFraction;
            // add spacing
            y += spacing - thumbnail.collapseFraction * spacing;

            if (i >= MAX_WORKSPACES) {
                break;
            }
        }

        // allocate the indicator (which tells us what is the current workspace)
        childBox.x1 = indicatorX;
        childBox.x2 = indicatorX + thumbnailWidth;
        childBox.y1 = indicatorY;
        childBox.y2 = indicatorY + thumbnailHeight;
        this._indicator.allocate(childBox, flags);
    },

    destroy: function () {
        this.actor.destroy();
        // @@ for now
        /*
        let i = this._signals.length;
        while (i--) {
            Main.overview.disconnect(this._signals[i]);
        }
        this._signals = [];
        */
    }
});

/* Get the thumbnails box to acknowledge a change in allowable width */
function refreshThumbnailsBox() {
    if (Main.overview.visible) {
        // we hope that when they close the overview and reopen it, that will
        // do the trick.
        // (they can't really use the prefs widget while in the overview anyway)
        return;
    }
    // get the thumbnailsbox to re-allocate itself
    // (TODO: for some reason the *first* overview show won't respect this but
    // subsequent ones will).
    //let wD = _getWorkspaceDisplay();
    //wD._thumbnailsBox.actor.queue_relayout();
    Main.overview._thumbnailsBox.actor.queue_relayout();
}

/**
 * We need to:
 * 1) override the scroll event on workspaces display to allow sideways
 *    scrolling too
 * 2) replace the old thumbnailsBox with our own (because you can't
 *    override ._getPreferredHeight etc that are passed in as *callbacks*).
 */
function overrideWorkspaceDisplay() {
    // 1. Override the scroll event.
    //    The _onScrollEvent function itself is quite fine, except it only allows
    //     scrolling up and down.
    //    For completeness I also allow scrolling left/right (though I can't test...)
    //    Note that this is done differently in GNOME 3.8: the event is triggered
    //     from each individual workspaces view in the workspaceDisplay rather
    //     than from the 'controls' object.
    wvStorage._init = WorkspacesView.WorkspacesView.prototype._init;
    WorkspacesView.WorkspacesView.prototype._init = function () {
        wvStorage._init.apply(this, arguments);
        this._horizontalScroll = this.actor.connect('scroll-event',
            Lang.bind(this, function () {
                // same as the original, but for LEFT/RIGHT
                if (!this.actor.mapped)
                    return false;
                switch (event.get_scroll_direction()) {
                case Clutter.ScrollDirection.LEFT:
                    Main.wm.actionMoveWorkspace(LEFT);
                    return true;
                case Clutter.ScrollDirection.RIGHT:
                    Main.wm.actionMoveWorkspace(RIGHT);
                    return true;
                }
                return false;
            }));
    };

    // 2. Replace workspacesDisplay._thumbnailsBox with my own.
    // Start with controls collapsed (since the workspace thumbnails can take
    // up quite a bit of space horizontally). This will be recalculated
    // every time the overview shows.

/*  The ThumbnailsBox class doesn't look that different in 3.8 (although we have to do
    something with _spliceIndex and queueUpdateStates in acceptDrop)
    However, the thumbnails box is now managed by the new OverviewControls.ControlsManager
     which makes an OverviewControls.ThumbnailsSlider for it (before it was managed
     by the WorkspacesDisplay).
    I have to work out how these work.
*/

    // GNOME 3.8: ThumbnailsBox is owned by the overview/ControlsManager
    // OK: this sort of works. It displays in the grid format, but doesn't seem to ever collapse.
    //  (TODO: destroy the old slider/thumbnails box?)
    // BUT the scroll event crashes the shell
    // ALSO clicking crashes the shell (error below):
    // (gnome-shell:1037): St-ERROR **: st_widget_get_theme_node called on the widget
    //   [0x90fa708 StBin.workspace-thumbnail-indicator:last-child] which is not in the stage.

    let controls = Main.overview._controls,
    thumbnailsBox = new ThumbnailsBox();
/*
    let slider = new OverviewControls.ThumbnailsSlider(thumbnailsBox);

    Main.overview._group.remove_actor(controls.thumbnailsActor);
    controls._thumbnailsSlider = slider;
    controls.thumbnailsActor = slider.actor;
    Main.overview._thumbnailsBox = thumbnailsBox;
    Main.overview._group.add_actor(slider.actor);
*/

    // kill the old thumbnails box
    controls.thumbnailsActor.remove_actor(Main.overview._thumbnailsBox.actor);
    Main.overview._thumbnailsBox.actor.destroy();
    thumbnailsBox = new ThumbnailsBox();
    Main.overview._thumbnailsBox = thumbnailsBox;
    controls._thumbnailsSlider._thumbnailsBox = thumbnailsBox;
    controls.thumbnailsActor.add_actor(thumbnailsBox.actor);
    thumbnailsBox.actor.y_expand = true;

    // TODO: destroy the old ones???
    // TODO: can I avoid replacing the thumbnailsslider?

    // wD._alwaysZoomOut = false;
    // error: child is null.

//    refreshThumbnailsBox();
}

function unoverrideWorkspaceDisplay() {
    let wD = _getWorkspaceDisplay();

    // undo scroll event patching
    WorkspacesView.WorkspacesView.prototype._init = wvStorage._init;
    for (let i = 0; i < wD._workspacesViews.length; ++i) {
        let wV = wD._workspacesViews[i];
        if (wV._horizontalScroll) {
            wV.disconnect(wV._horizontalScroll);
        }
    }

/*
    // replace the ThumbnailsBox with the original one
    thumbnailsBox.destroy();
    thumbnailsBox = null;
    // ... more
*/
}

/******************
 * tells Meta about the number of workspaces we want
 ******************/
function modifyNumWorkspaces() {
    /// Setting the number of workspaces.
    Meta.prefs_set_num_workspaces(
        global.screen.workspace_grid.rows * global.screen.workspace_grid.columns
    );

    /* NOTE: in GNOME 3.4, 3.6, 3.8, Meta.prefs_set_num_workspaces has
     * *no effect* if Meta.prefs_get_dynamic_workspaces is true.
     * (see mutter/src/core/screen.c prefs_changed_callback).
     * To *actually* increase/decrease the number of workspaces (to fire
     * notify::n-workspaces), we must use global.screen.append_new_workspace and
     * global.screen.remove_workspace.
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
    let newtotal = (global.screen.workspace_grid.rows *
        global.screen.workspace_grid.columns);
    if (global.screen.n_workspaces < newtotal) {
        for (let i = global.screen.n_workspaces; i < newtotal; ++i) {
            global.screen.append_new_workspace(false,
                    global.get_current_time());
        }
    } else if (global.screen.n_workspaces > newtotal) {
        for (let i = global.screen.n_workspaces - 1; i >= newtotal; --i) {
            global.screen.remove_workspace(
                    global.screen.get_workspace_by_index(i),
                    global.get_current_time()
            );
        }
    }

    // This affects workspace.get_neighbor() (only exposed in 3.8+) and appears
    // to do not much else. We'll do it anyway just in case.
    global.screen.override_workspace_layout(
        Meta.ScreenCorner.TOPLEFT, // workspace 0
        false, // true == lay out in columns. false == lay out in rows
        global.screen.workspace_grid.rows,
        global.screen.workspace_grid.columns
    );

    // this forces the workspaces display to update itself to match the new
    // number of workspaces.
    global.screen.notify('n-workspaces');
}

function unmodifyNumWorkspaces() {
    // restore original number of workspaces
    Meta.prefs_set_num_workspaces(nWorkspaces);

    global.screen.override_workspace_layout(
        Meta.ScreenCorner.TOPLEFT, // workspace 0
        true, // true == lay out in columns. false == lay out in rows
        nWorkspaces,
        1 // columns
    );
}

/******************
 * This is the stuff from Frippery Static Workspaces
 ******************/
function dummy() {
    return false;
}

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

/******************
 * Store rows/cols of workspaces, convenience functions to
 * global.screen.workspace_grid
 * such that if other extension authors want to they can use them.
 *
 * Exported constants:
 * Directions = { UP, LEFT, RIGHT, DOWN } : directions for navigating workspaces
 * rows     : number of rows of workspaces
 * columns  : number of columns of workspaces
 *
 * Exported functions:
 * rowColToIndex : converts the row/column into an index for use with (e.g.)
 *                 global.screen.get_workspace_by_index(i)
 * indexToRowCol : converts an index (0 to global.screen.n_workspaces-1) to a
 *                 row and column
 * moveWorkspace : switches workspaces in the direction specified, being either
 *                 UP, LEFT, RIGHT or DOWN (see Directions).
 ******************/
function exportFunctionsAndConstants() {
    global.screen.workspace_grid = {
        Directions: {
            UP: UP,
            LEFT: LEFT,
            RIGHT: RIGHT,
            DOWN: DOWN
        },

        rows: settings.get_int(KEY_ROWS),
        columns: settings.get_int(KEY_COLS),

        rowColToIndex: rowColToIndex,
        indexToRowCol: indexToRowCol,
        getWorkspaceSwitcherPopup: getWorkspaceSwitcherPopup,
        calculateWorkspace: calculateWorkspace,
        moveWorkspace: moveWorkspace
    };

    // It seems you can only have 36 workspaces max.
    if (settings.get_int(KEY_ROWS) * settings.get_int(KEY_COLS) >
            MAX_WORKSPACES) {
        log("WARNING [workspace-grid]: You can have at most 36 workspaces, " +
                "will ignore the rest");
        global.screen.workspace_grid.rows = Math.ceil(
                MAX_WORKSPACES / global.screen.workspace_grid.columns);
    }
}

function unexportFunctionsAndConstants() {
    delete global.screen.workspace_grid;
}

/***************************
 *         EXTENSION       *
 ***************************/

function init() {
}

let signals = [];
function enable() {
    /// Storage
    nWorkspaces = Meta.prefs_get_num_workspaces();

    settings = Convenience.getSettings();
    makeWorkspacesStatic();
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
    signals.push(settings.connect('changed::' + KEY_ROWS, nWorkspacesChanged));
    signals.push(settings.connect('changed::' + KEY_COLS, nWorkspacesChanged));
//@@    signals.push(settings.connect('changed::' + KEY_MAX_HFRACTION, refreshThumbnailsBox));
//@@    signals.push(settings.connect('changed::' + KEY_MAX_HFRACTION_COLLAPSE, refreshThumbnailsBox));
}

function nWorkspacesChanged() {
    // re-export new rows/cols
    exportFunctionsAndConstants();
    // reset the number of workspaces
    modifyNumWorkspaces();
}

function disable() {
    unoverrideWorkspaceDisplay();
    unoverrideKeybindingsAndPopup();
    unmodifyNumWorkspaces();
    unexportFunctionsAndConstants();
    unmakeWorkspacesStatic();

    let i = signals.length;
    while (i--) {
        settings.disconnect(signals.pop());
    }

    // just in case, let everything else get used to the new number of
    // workspaces.
    global.screen.notify('n-workspaces');
}
