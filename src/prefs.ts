import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PANEL_POSITION_KEY = 'panel-position';
const PANEL_INDEX_KEY = 'panel-index';
const ALBUM_ART_GRAYSCALE_KEY = 'album-art-grayscale';
const HIDE_WHEN_NO_PLAYERS_KEY = 'hide-when-no-players';
const PANEL_LABEL_SCROLL_KEY = 'panel-label-scroll';
const PLAYER_FILTER_MODE_KEY = 'player-filter-mode';
const PLAYER_FILTER_WHITELIST_KEY = 'player-filter-whitelist';
const PANEL_POSITIONS = ['left', 'center', 'right'] as const;
const PLAYER_FILTER_MODES = ['all', 'whitelist'] as const;
const MPRIS_BUS_PREFIX = 'org.mpris.MediaPlayer2.';

interface DiscoveredPlayer {
  identity?: string;
}

function getPlayerAppId(busName: string, desktopEntry?: string): string {
  if (desktopEntry) return desktopEntry;
  const suffix = busName.startsWith(MPRIS_BUS_PREFIX)
    ? busName.slice(MPRIS_BUS_PREFIX.length)
    : busName;
  return suffix.replace(/\.instance[-_.].*$/i, '');
}

function listBusNames(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    Gio.DBus.session.call(
      'org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      'org.freedesktop.DBus',
      'ListNames',
      null,
      new GLib.VariantType('(as)'),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (connection, result) => {
        try {
          const reply = connection!.call_finish(result);
          const [names] = reply.deepUnpack() as [string[]];
          resolve(names);
        } catch (error) {
          reject(error as Error);
        }
      },
    );
  });
}

function getPlayerProperties(
  busName: string,
): Promise<{ desktopEntry?: string; identity?: string }> {
  return new Promise((resolve) => {
    Gio.DBus.session.call(
      busName,
      '/org/mpris/MediaPlayer2',
      'org.freedesktop.DBus.Properties',
      'GetAll',
      new GLib.Variant('(s)', ['org.mpris.MediaPlayer2']),
      new GLib.VariantType('(a{sv})'),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (connection, result) => {
        try {
          const reply = connection!.call_finish(result);
          const [props] = reply.recursiveUnpack() as [Record<string, unknown>];
          const identity = typeof props.Identity === 'string' ? props.Identity : undefined;
          const desktopEntry =
            typeof props.DesktopEntry === 'string' ? props.DesktopEntry : undefined;
          resolve({ desktopEntry, identity });
        } catch {
          resolve({});
        }
      },
    );
  });
}

export default class MediaControlPreferences extends ExtensionPreferences {
  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({
      title: 'Panel',
    });

    const positionRow = new Adw.ComboRow({
      title: 'Panel position',
      subtitle: 'Which section of the top panel to use.',
      model: new Gtk.StringList({
        strings: ['Left', 'Center', 'Right'],
      }),
    });

    const setPositionRowFromSettings = () => {
      const index = PANEL_POSITIONS.indexOf(
        settings.get_string(PANEL_POSITION_KEY) as (typeof PANEL_POSITIONS)[number],
      );
      if (index >= 0) positionRow.selected = index;
    };

    setPositionRowFromSettings();
    positionRow.connect('notify::selected', () => {
      settings.set_string(PANEL_POSITION_KEY, PANEL_POSITIONS[positionRow.selected]);
    });
    settings.connect(`changed::${PANEL_POSITION_KEY}`, setPositionRowFromSettings);

    const indexRow = new Adw.SpinRow({
      title: 'Index in panel',
      subtitle: 'Order within the panel section (0 is leftmost).',
      adjustment: new Gtk.Adjustment({
        lower: 0,
        upper: 99,
        step_increment: 1,
      }),
    });

    settings.bind(PANEL_INDEX_KEY, indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);

    const hideWhenEmptyRow = new Adw.SwitchRow({
      title: 'Hide when no players',
      subtitle: 'Remove the panel indicator when nothing is playing.',
    });
    settings.bind(
      HIDE_WHEN_NO_PLAYERS_KEY,
      hideWhenEmptyRow,
      'active',
      Gio.SettingsBindFlags.DEFAULT,
    );

    const scrollLabelRow = new Adw.SwitchRow({
      title: 'Scroll panel label',
      subtitle: 'Scroll long track titles instead of truncating them.',
    });
    settings.bind(PANEL_LABEL_SCROLL_KEY, scrollLabelRow, 'active', Gio.SettingsBindFlags.DEFAULT);

    group.add(positionRow);
    group.add(indexRow);
    group.add(hideWhenEmptyRow);
    group.add(scrollLabelRow);
    page.add(group);

    const appearanceGroup = new Adw.PreferencesGroup({
      title: 'Appearance',
    });
    const grayscaleRow = new Adw.SwitchRow({
      title: 'Grayscale album art',
      subtitle: 'Show album artwork in black and white.',
    });
    settings.bind(ALBUM_ART_GRAYSCALE_KEY, grayscaleRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    appearanceGroup.add(grayscaleRow);
    page.add(appearanceGroup);

    this._addPlayerFilterGroup(page, settings);

    window.add(page);
  }

  private _addPlayerFilterGroup(page: Adw.PreferencesPage, settings: Gio.Settings): void {
    const filterGroup = new Adw.PreferencesGroup({
      title: 'Players',
    });

    const modeRow = new Adw.ComboRow({
      title: 'Filter players',
      subtitle: 'Choose which media players can be picked.',
      model: new Gtk.StringList({
        strings: ['All players', 'Whitelist only'],
      }),
    });

    const setModeRowFromSettings = () => {
      const index = PLAYER_FILTER_MODES.indexOf(
        settings.get_string(PLAYER_FILTER_MODE_KEY) as (typeof PLAYER_FILTER_MODES)[number],
      );
      if (index >= 0) modeRow.selected = index;
    };
    setModeRowFromSettings();
    modeRow.connect('notify::selected', () => {
      settings.set_string(PLAYER_FILTER_MODE_KEY, PLAYER_FILTER_MODES[modeRow.selected]);
    });

    filterGroup.add(modeRow);
    page.add(filterGroup);

    const whitelistGroup = new Adw.PreferencesGroup({
      title: 'Allowed players',
      description: 'Only the selected apps will be picked while playing.',
    });

    const refreshButton = new Gtk.Button({
      icon_name: 'view-refresh-symbolic',
      valign: Gtk.Align.CENTER,
      tooltip_text: 'Refresh detected players',
      css_classes: ['flat'],
    });
    whitelistGroup.set_header_suffix(refreshButton);
    page.add(whitelistGroup);

    const discovered = new Map<string, DiscoveredPlayer>();
    const whitelistRows: Gtk.Widget[] = [];
    let rebuilding = false;

    const rebuildWhitelistRows = () => {
      rebuilding = true;
      for (const row of whitelistRows) whitelistGroup.remove(row);
      whitelistRows.length = 0;

      const whitelist = settings.get_strv(PLAYER_FILTER_WHITELIST_KEY);
      const ids = new Set<string>([...discovered.keys(), ...whitelist]);

      if (ids.size === 0) {
        const emptyRow = new Adw.ActionRow({
          title: 'No media players detected',
          subtitle: 'Start playing something, then refresh.',
        });
        whitelistGroup.add(emptyRow);
        whitelistRows.push(emptyRow);
        rebuilding = false;
        return;
      }

      const sortedIds = [...ids].sort((a, b) =>
        (discovered.get(a)?.identity ?? a).localeCompare(discovered.get(b)?.identity ?? b),
      );

      for (const id of sortedIds) {
        const info = discovered.get(id);
        const running = info !== undefined;
        const row = new Adw.SwitchRow({
          title: info?.identity || id,
          subtitle: running ? id : `${id} · not running`,
          active: whitelist.includes(id),
        });
        row.connect('notify::active', () => {
          if (rebuilding) return;
          const current = settings.get_strv(PLAYER_FILTER_WHITELIST_KEY);
          if (row.active) {
            if (!current.includes(id)) {
              settings.set_strv(PLAYER_FILTER_WHITELIST_KEY, [...current, id]);
            }
          } else {
            settings.set_strv(
              PLAYER_FILTER_WHITELIST_KEY,
              current.filter((entry) => entry !== id),
            );
          }
        });
        whitelistGroup.add(row);
        whitelistRows.push(row);
      }
      rebuilding = false;
    };

    const refresh = async () => {
      try {
        const names = await listBusNames();
        const mprisNames = names.filter((name) => name.startsWith(MPRIS_BUS_PREFIX));
        const found = new Map<string, DiscoveredPlayer>();
        await Promise.all(
          mprisNames.map(async (busName) => {
            const props = await getPlayerProperties(busName);
            const id = getPlayerAppId(busName, props.desktopEntry);
            if (!found.has(id)) found.set(id, { identity: props.identity });
          }),
        );
        discovered.clear();
        for (const [id, info] of found) discovered.set(id, info);
      } catch {
        // Ignore discovery failures; the whitelist can still be managed manually.
      }
      rebuildWhitelistRows();
    };

    const updateWhitelistVisibility = () => {
      whitelistGroup.visible = settings.get_string(PLAYER_FILTER_MODE_KEY) === 'whitelist';
    };

    settings.connect(`changed::${PLAYER_FILTER_MODE_KEY}`, () => {
      setModeRowFromSettings();
      updateWhitelistVisibility();
    });
    refreshButton.connect('clicked', () => void refresh());

    updateWhitelistVisibility();
    rebuildWhitelistRows();
    void refresh();
  }
}
