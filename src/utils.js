/***********************************************************************
 * Copyright (C)      2018 Matthieu Baerts <matttbe@gmail.com>         *
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

const Meta = imports.gi.Meta;
const ShellVersion = imports.misc.config.PACKAGE_VERSION.split(".");
const ShellVersionId =
    (parseInt(ShellVersion[0]) << 8) + parseInt(ShellVersion[1]);

function isVersionAbove(major, minor) {
    return ShellVersionId > (major << 8) + minor;
}

// Inspired by https://github.com/micheleg/dash-to-dock/commit/8398d41
// Maintain compatibility with GNOME-Shell 3.30+ as well as previous versions.
var WS = {
    getWS: function() {
        if (isVersionAbove(3, 28)) {
            return global.workspace_manager;
        }
        return global.screen;
    },
    getCorner: function() {
        if (isVersionAbove(3, 28)) {
            return Meta.DisplayCorner;
        }
        return Meta.ScreenCorner;
    }
};
