import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PANEL_POSITION_KEY = 'panel-position';
const PANEL_INDEX_KEY = 'panel-index';
const ALBUM_ART_GRAYSCALE_KEY = 'album-art-grayscale';
const HIDE_WHEN_NO_PLAYERS_KEY = 'hide-when-no-players';
const PANEL_LABEL_SCROLL_KEY = 'panel-label-scroll';
const PANEL_POSITIONS = ['left', 'center', 'right'] as const;

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

    window.add(page);
  }
}
