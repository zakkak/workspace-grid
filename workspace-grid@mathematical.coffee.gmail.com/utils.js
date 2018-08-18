/***********************************************************************
 * Copyright (C)      2015 Foivos S. Zakkak <foivos@zakkak.net         *
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

const Meta = imports.gi.Meta;

// Inspired by https://github.com/micheleg/dash-to-dock/commit/8398d41
// Maintain compatibility with GNOME-Shell 3.30+ as well as previous versions.
var WS = {
    getWS: function() {
        return global.screen || global.workspace_manager;
    },
    getCorner: function() {
        return Meta.ScreenCorner || Meta.DisplayCorner;
    }
};
