import type Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { MprisSource } from 'resource:///org/gnome/shell/ui/mpris.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const ALBUM_ART_GRAYSCALE_KEY = 'album-art-grayscale';
const HIDE_WHEN_NO_PLAYERS_KEY = 'hide-when-no-players';
const PANEL_LABEL_SCROLL_KEY = 'panel-label-scroll';
const PLAYER_FILTER_MODE_KEY = 'player-filter-mode';
const PLAYER_FILTER_WHITELIST_KEY = 'player-filter-whitelist';
const MPRIS_BUS_PREFIX = 'org.mpris.MediaPlayer2.';
const PANEL_MAX_CHARS = 24;
const TITLE_SCROLL_INTERVAL_MS = 50;
const TITLE_SCROLL_PX_PER_TICK = 1;
const TITLE_SCROLL_PAUSE_TICKS = 30;

interface MprisPlayer {
  status: string;
  trackArtists: string | string[];
  trackTitle: string;
  trackCoverUrl: string;
  canGoNext: boolean;
  canGoPrevious: boolean;
  playPause: () => void;
  next: () => void;
  previous: () => void;
  connect: (signal: 'changed', callback: () => void) => number;
  disconnect: (id: number) => void;
  _busName?: string;
  _mprisProxy?: { DesktopEntry?: string; Identity?: string };
}

function formatArtists(artists: string | string[]): string {
  if (Array.isArray(artists)) return artists.join(', ');
  return artists;
}

export function getPlayerAppId(busName: string, desktopEntry?: string): string {
  if (desktopEntry) return desktopEntry;
  const suffix = busName.startsWith(MPRIS_BUS_PREFIX)
    ? busName.slice(MPRIS_BUS_PREFIX.length)
    : busName;
  return suffix.replace(/\.instance[-_.].*$/i, '');
}

function playerAppId(player: MprisPlayer): string {
  return getPlayerAppId(player._busName ?? '', player._mprisProxy?.DesktopEntry);
}

function pickActivePlayer(players: MprisPlayer[]): MprisPlayer | null {
  if (players.length === 0) return null;
  return players.find((player) => player.status === 'Playing') ?? players[0];
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

interface ScrollingTitleOptions {
  labelStyleClass?: string;
  clipStyleClass?: string;
  clipYAlign?: Clutter.ActorAlign;
}

class ScrollingTitle {
  readonly actor: St.Widget;
  private readonly _clip: St.Widget;
  private readonly _label: St.Label;
  private _timeoutId = 0;
  private _layoutHandlerId = 0;
  private _scrollPosition = 0;
  private _scrollDirection = -1;
  private _pauseTicks = 0;
  private _overflow = 0;

  constructor(options: ScrollingTitleOptions = {}) {
    this._label = new St.Label({
      style_class: options.labelStyleClass ?? 'media-control-card-title',
    });
    this._clip = new St.Widget({
      style_class: options.clipStyleClass ?? 'media-control-card-title-clip',
      clip_to_allocation: true,
      x_expand: true,
      ...(options.clipYAlign !== undefined ? { y_align: options.clipYAlign } : {}),
    });
    this._clip.add_child(this._label);
    this.actor = this._clip;
    this._clip.connect('notify::visible', () => {
      if (this._clip.visible) this._scheduleScrollUpdate();
      else this._stopScroll();
    });
  }

  setText(text: string) {
    this._stopScroll();
    this._label.text = text;
    this._label.translation_x = 0;
    this._scheduleScrollUpdate();
  }

  destroy() {
    if (this._layoutHandlerId) {
      this._clip.disconnect(this._layoutHandlerId);
      this._layoutHandlerId = 0;
    }
    this._stopScroll();
  }

  private _scheduleScrollUpdate() {
    if (this._layoutHandlerId) {
      this._clip.disconnect(this._layoutHandlerId);
      this._layoutHandlerId = 0;
    }

    const update = () => {
      if (this._clip.width <= 0) return;
      if (this._layoutHandlerId) {
        this._clip.disconnect(this._layoutHandlerId);
        this._layoutHandlerId = 0;
      }
      this._startScrollIfNeeded();
    };

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      update();
      return GLib.SOURCE_REMOVE;
    });
    this._layoutHandlerId = this._clip.connect('notify::width', update);
  }

  private _startScrollIfNeeded() {
    this._stopScroll();

    const clipWidth = this._clip.width;
    const [, labelWidth] = this._label.get_preferred_width(-1);
    if (labelWidth <= clipWidth) {
      this._label.translation_x = 0;
      return;
    }

    this._overflow = labelWidth - clipWidth;
    this._scrollPosition = 0;
    this._scrollDirection = -1;
    this._pauseTicks = TITLE_SCROLL_PAUSE_TICKS;
    this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TITLE_SCROLL_INTERVAL_MS, () => {
      if (!this._clip.visible) {
        this._stopScroll();
        return GLib.SOURCE_REMOVE;
      }

      if (this._pauseTicks > 0) {
        this._pauseTicks--;
        return GLib.SOURCE_CONTINUE;
      }

      const pxPerTick =
        this._scrollDirection === 1 ? TITLE_SCROLL_PX_PER_TICK * 2 : TITLE_SCROLL_PX_PER_TICK;
      this._scrollPosition += this._scrollDirection * pxPerTick;
      if (this._scrollPosition <= -this._overflow) {
        this._scrollPosition = -this._overflow;
        this._pauseTicks = TITLE_SCROLL_PAUSE_TICKS;
        this._scrollDirection = 1;
      } else if (this._scrollPosition >= 0) {
        this._scrollPosition = 0;
        this._pauseTicks = TITLE_SCROLL_PAUSE_TICKS;
        this._scrollDirection = -1;
      }

      this._label.translation_x = this._scrollPosition;
      return GLib.SOURCE_CONTINUE;
    });
  }

  private _stopScroll() {
    if (this._timeoutId) {
      GLib.source_remove(this._timeoutId);
      this._timeoutId = 0;
    }
  }
}

function makeCircleButton(
  iconName: string,
  styleClass: string,
  iconSize: number,
): { button: St.Button; icon: St.Icon } {
  const icon = new St.Icon({
    icon_name: iconName,
    icon_size: iconSize,
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.CENTER,
  });
  const button = new St.Button({
    style_class: styleClass,
    child: icon,
    can_focus: true,
    x_align: Clutter.ActorAlign.CENTER,
    y_align: Clutter.ActorAlign.CENTER,
  });
  return { button, icon };
}

const MediaCardItem = GObject.registerClass(
  class MediaCardItem extends PopupMenu.PopupBaseMenuItem {
    private _cover!: St.Widget;
    private _coverPlaceholderIcon!: St.Icon;
    private _coverDesaturate: Clutter.DesaturateEffect | null = null;
    private _titleScroller!: ScrollingTitle;
    private _subtitleLabel!: St.Label;

    prevButton!: St.Button;
    nextButton!: St.Button;
    playButton!: St.Button;
    private _playIcon!: St.Icon;

    _init() {
      super._init({
        reactive: false,
        can_focus: false,
        style_class: 'media-control-card-item',
      });

      const card = new St.Widget({
        style_class: 'media-control-card',
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
      });

      this._cover = new St.Widget({
        style_class: 'media-control-card-cover',
        x_expand: true,
        y_expand: true,
      });
      this._coverPlaceholderIcon = new St.Icon({
        style_class: 'media-control-card-cover-placeholder',
        icon_name: 'audio-x-generic-symbolic',
        icon_size: 64,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._coverPlaceholderIcon.hide();
      const overlay = new St.Widget({
        style_class: 'media-control-card-overlay',
        x_expand: true,
        y_expand: true,
      });

      const content = new St.BoxLayout({
        vertical: true,
        style_class: 'media-control-card-content',
        x_expand: true,
        y_expand: true,
      });

      const spacer = new St.Widget({ y_expand: true });

      const bottomRow = new St.BoxLayout({
        style_class: 'media-control-card-bottom',
        y_align: Clutter.ActorAlign.END,
      });

      const textBox = new St.BoxLayout({
        vertical: true,
        style_class: 'media-control-card-text',
        x_expand: true,
        y_align: Clutter.ActorAlign.END,
      });
      this._titleScroller = new ScrollingTitle();
      this._subtitleLabel = new St.Label({
        style_class: 'media-control-card-subtitle',
      });
      this._subtitleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      textBox.add_child(this._titleScroller.actor);
      textBox.add_child(this._subtitleLabel);

      const controls = new St.BoxLayout({
        style_class: 'media-control-card-controls',
        y_align: Clutter.ActorAlign.CENTER,
      });
      const prev = makeCircleButton(
        'media-skip-backward-symbolic',
        'media-control-circle-button',
        13,
      );
      const next = makeCircleButton(
        'media-skip-forward-symbolic',
        'media-control-circle-button',
        13,
      );
      const play = makeCircleButton(
        'media-playback-start-symbolic',
        'media-control-play-button',
        20,
      );
      this.prevButton = prev.button;
      this.nextButton = next.button;
      this.playButton = play.button;
      this._playIcon = play.icon;
      controls.add_child(prev.button);
      controls.add_child(play.button);
      controls.add_child(next.button);

      bottomRow.add_child(textBox);
      bottomRow.add_child(controls);

      content.add_child(spacer);
      content.add_child(bottomRow);

      card.add_child(this._cover);
      card.add_child(this._coverPlaceholderIcon);
      card.add_child(overlay);
      card.add_child(content);
      this.add_child(card);
    }

    setCoverUrl(url: string) {
      if (url) {
        const safe = url.replace(/"/g, '%22');
        this._cover.style = `background-image: url("${safe}"); background-size: cover; background-position: center;`;
        this._cover.add_style_class_name('media-control-card-cover-loaded');
        this._coverPlaceholderIcon.hide();
      } else {
        this._cover.style = null;
        this._cover.remove_style_class_name('media-control-card-cover-loaded');
        this._coverPlaceholderIcon.show();
      }
    }

    setPlaying(playing: boolean) {
      this._playIcon.icon_name = playing
        ? 'media-playback-pause-symbolic'
        : 'media-playback-start-symbolic';
    }

    setTitle(title: string) {
      this._titleScroller.setText(title);
    }

    override destroy(): void {
      this.setGrayscale(false);
      this._titleScroller.destroy();
      super.destroy();
    }

    setSubtitle(subtitle: string) {
      this._subtitleLabel.text = subtitle;
    }

    setGrayscale(enabled: boolean) {
      if (enabled) {
        if (!this._coverDesaturate) {
          this._coverDesaturate = new Clutter.DesaturateEffect({ factor: 1.0 });
          this._cover.add_effect(this._coverDesaturate);
        }
        return;
      }
      if (this._coverDesaturate) {
        this._cover.remove_effect(this._coverDesaturate);
        this._coverDesaturate = null;
      }
    }
  },
);

export const MediaIndicator = GObject.registerClass(
  class MediaIndicator extends PanelMenu.Button {
    private _mpris!: MprisSource;
    private _activePlayer!: MprisPlayer | null;
    private _playerChangedId!: number;
    private _watchIds!: Map<MprisPlayer, number>;

    private _icon!: St.Icon;
    private _coverButton!: St.Button;
    private _coverBg!: St.Widget;
    private _panelCoverDesaturate: Clutter.DesaturateEffect | null = null;
    private _coverPlayIcon!: St.Icon;
    private _coverPlaceholderIcon!: St.Icon;
    private _panelHasCover = false;
    private _settings!: Gio.Settings;
    private _grayscaleSettingsId = 0;
    private _hideWhenNoPlayersSettingsId = 0;
    private _panelLabelScrollSettingsId = 0;
    private _playerFilterModeSettingsId = 0;
    private _playerFilterWhitelistSettingsId = 0;
    private _panelCoverHovered = false;
    private _panelBox!: St.BoxLayout;
    private _panelLabelActor!: St.Widget;
    private _panelScroller: ScrollingTitle | null = null;
    private _panelStaticLabel: St.Label | null = null;
    private _panelTitle = '';
    private _cardItem!: InstanceType<typeof MediaCardItem>;
    private _emptyItem!: PopupMenu.PopupMenuItem;

    _init() {
      this._activePlayer = null;
      this._playerChangedId = 0;
      this._watchIds = new Map();

      super._init(0.5, 'Now Playing');

      this._panelBox = new St.BoxLayout({
        style_class: 'media-control-panel-box',
      });
      this._icon = new St.Icon({
        icon_name: 'audio-x-generic-symbolic',
        style_class: 'system-status-icon',
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._coverBg = new St.Widget({
        style_class: 'media-control-panel-cover-bg',
        x_expand: true,
        y_expand: true,
      });
      this._coverPlayIcon = new St.Icon({
        style_class: 'media-control-panel-play-icon',
        icon_name: 'media-playback-start-symbolic',
        icon_size: 12,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._coverPlaceholderIcon = new St.Icon({
        style_class: 'media-control-panel-cover-placeholder',
        icon_name: 'audio-x-generic-symbolic',
        icon_size: 12,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      const coverBin = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
      });
      coverBin.add_child(this._coverBg);
      coverBin.add_child(this._coverPlaceholderIcon);
      coverBin.add_child(this._coverPlayIcon);
      this._coverPlaceholderIcon.hide();
      this._coverPlayIcon.hide();
      this._coverButton = new St.Button({
        style_class: 'media-control-panel-cover-button',
        child: coverBin,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
        track_hover: true,
      });
      this._coverButton.hide();
      this._coverButton.connect('enter-event', () => this._setPanelCoverHovered(true));
      this._coverButton.connect('leave-event', () => this._setPanelCoverHovered(false));
      this._coverButton.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
        this._activePlayer?.playPause();
        return Clutter.EVENT_STOP;
      });
      this._panelStaticLabel = new St.Label({
        style_class: 'media-control-panel-label',
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._panelStaticLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
      this._panelLabelActor = this._panelStaticLabel;
      this._panelBox.add_child(this._icon);
      this._panelBox.add_child(this._coverButton);
      this._panelBox.add_child(this._panelLabelActor);
      this._panelLabelActor.hide();
      this.add_child(this._panelBox);

      this._mpris = new MprisSource();
      this._mpris.connect('player-added', () => this._onPlayersChanged());
      this._mpris.connect('player-removed', () => this._onPlayersChanged());

      this._buildMenu();
      this._onPlayersChanged();
    }

    bindSettings(settings: Gio.Settings) {
      if (this._grayscaleSettingsId) return;

      this._settings = settings;
      this._grayscaleSettingsId = settings.connect(`changed::${ALBUM_ART_GRAYSCALE_KEY}`, () =>
        this._applyAlbumArtGrayscale(),
      );
      this._hideWhenNoPlayersSettingsId = settings.connect(
        `changed::${HIDE_WHEN_NO_PLAYERS_KEY}`,
        () => this._updatePanelVisibility(),
      );
      this._panelLabelScrollSettingsId = settings.connect(
        `changed::${PANEL_LABEL_SCROLL_KEY}`,
        () => this._applyPanelLabelWidget(),
      );
      this._playerFilterModeSettingsId = settings.connect(
        `changed::${PLAYER_FILTER_MODE_KEY}`,
        () => this._onPlayersChanged(),
      );
      this._playerFilterWhitelistSettingsId = settings.connect(
        `changed::${PLAYER_FILTER_WHITELIST_KEY}`,
        () => this._onPlayersChanged(),
      );
      this._applyAlbumArtGrayscale();
      this._updatePanelVisibility();
      this._applyPanelLabelWidget();
      this._onPlayersChanged();
    }

    private _eligiblePlayers(): MprisPlayer[] {
      const players = this._mpris.players as MprisPlayer[];
      const mode = this._settings?.get_string(PLAYER_FILTER_MODE_KEY) ?? 'all';
      if (mode !== 'whitelist') return players;

      const whitelist = new Set(this._settings?.get_strv(PLAYER_FILTER_WHITELIST_KEY) ?? []);
      return players.filter((player) => whitelist.has(playerAppId(player)));
    }

    _applyPanelLabelWidget() {
      const scroll = this._settings?.get_boolean(PANEL_LABEL_SCROLL_KEY) ?? false;
      const oldActor = this._panelLabelActor;
      const wasVisible = oldActor?.visible ?? false;

      if (this._panelScroller) {
        this._panelScroller.destroy();
        this._panelScroller = null;
      }
      this._panelStaticLabel = null;

      if (scroll) {
        this._panelScroller = new ScrollingTitle({
          labelStyleClass: 'media-control-panel-label',
          clipStyleClass: 'media-control-panel-label-clip',
          clipYAlign: Clutter.ActorAlign.CENTER,
        });
        this._panelLabelActor = this._panelScroller.actor;
        if (this._panelTitle) this._panelScroller.setText(this._panelTitle);
      } else {
        this._panelStaticLabel = new St.Label({
          style_class: 'media-control-panel-label',
          y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelStaticLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._panelLabelActor = this._panelStaticLabel;
        if (this._panelTitle)
          this._panelStaticLabel.text = truncate(this._panelTitle, PANEL_MAX_CHARS);
      }

      if (oldActor && this._panelBox.contains(oldActor)) this._panelBox.remove_child(oldActor);
      this._panelBox.add_child(this._panelLabelActor);
      if (wasVisible) this._panelLabelActor.show();
      else this._panelLabelActor.hide();
    }

    _setPanelTitle(title: string) {
      this._panelTitle = title;
      if (this._panelScroller) this._panelScroller.setText(title);
      else if (this._panelStaticLabel)
        this._panelStaticLabel.text = truncate(title, PANEL_MAX_CHARS);
    }

    _buildMenu() {
      const menu = this.menu as PopupMenu.PopupMenu;
      menu.box.add_style_class_name('media-control-menu-box');

      this._cardItem = new MediaCardItem();
      this._cardItem.prevButton.connect('clicked', () => this._activePlayer?.previous());
      this._cardItem.nextButton.connect('clicked', () => this._activePlayer?.next());
      this._cardItem.playButton.connect('clicked', () => this._activePlayer?.playPause());

      this._emptyItem = new PopupMenu.PopupMenuItem('No media playing', {
        reactive: false,
        can_focus: false,
      });

      menu.addMenuItem(this._cardItem);
      menu.addMenuItem(this._emptyItem);
    }

    _onPlayersChanged() {
      for (const [player, id] of this._watchIds) {
        player.disconnect(id);
        this._watchIds.delete(player);
      }

      if (this._activePlayer && this._playerChangedId) {
        this._activePlayer.disconnect(this._playerChangedId);
        this._playerChangedId = 0;
      }

      this._activePlayer = pickActivePlayer(this._eligiblePlayers());

      for (const player of this._mpris.players as MprisPlayer[]) {
        const id = player.connect('changed', () => this._onPlayerStateChanged());
        this._watchIds.set(player, id);
      }

      if (this._activePlayer) {
        this._playerChangedId = this._activePlayer.connect('changed', () => this._updateDisplay());
      }

      this._updateDisplay();
    }

    _onPlayerStateChanged() {
      const next = pickActivePlayer(this._eligiblePlayers());
      if (next !== this._activePlayer) this._onPlayersChanged();
      else this._updateDisplay();
    }

    _updateDisplay() {
      const player = this._activePlayer;
      const hasPlayer = player !== null;

      this._emptyItem.visible = !hasPlayer;
      this._cardItem.visible = hasPlayer;

      if (!player) {
        this._setPanelCover('');
        this._setPanelCoverHovered(false);
        this._coverButton.hide();
        this._icon.show();
        this._panelLabelActor.hide();
        this._coverButton.reactive = false;
        this.setSensitive(true);
      } else {
        const title = player.trackTitle;
        const artists = formatArtists(player.trackArtists);
        const playing = player.status === 'Playing';

        this._icon.hide();
        this._coverButton.show();
        this._coverButton.reactive = true;
        this._setPanelCover(player.trackCoverUrl);
        this._setPanelPlaying(playing);

        if (title) {
          this._setPanelTitle(title);
          this._panelLabelActor.show();
        } else {
          this._panelLabelActor.hide();
        }

        this._cardItem.setCoverUrl(player.trackCoverUrl);
        this._cardItem.setTitle(title || 'Unknown title');
        this._cardItem.setSubtitle(artists || 'Unknown artist');
        this._cardItem.setPlaying(playing);

        this._cardItem.prevButton.reactive = player.canGoPrevious;
        this._cardItem.nextButton.reactive = player.canGoNext;
        this.setSensitive(true);
      }

      this._updatePanelVisibility();
    }

    _updatePanelVisibility() {
      const hideWhenEmpty = this._settings?.get_boolean(HIDE_WHEN_NO_PLAYERS_KEY) ?? false;
      const hasPlayers = this._eligiblePlayers().length > 0;
      if (hideWhenEmpty && !hasPlayers) this.hide();
      else this.show();
    }

    _setPanelCover(url: string) {
      this._panelHasCover = !!url;
      if (url) {
        const safe = url.replace(/"/g, '%22');
        this._coverBg.style = `background-image: url("${safe}"); background-size: cover; background-position: center;`;
        this._coverBg.add_style_class_name('media-control-panel-cover-bg-loaded');
      } else {
        this._coverBg.style = null;
        this._coverBg.remove_style_class_name('media-control-panel-cover-bg-loaded');
      }
      this._syncPanelCoverView();
    }

    _setPanelPlaying(playing: boolean) {
      this._coverPlayIcon.icon_name = playing
        ? 'media-playback-pause-symbolic'
        : 'media-playback-start-symbolic';
    }

    _setPanelCoverHovered(hovered: boolean) {
      if (this._panelCoverHovered === hovered) return;
      this._panelCoverHovered = hovered;
      this._syncPanelCoverView();
    }

    _syncPanelCoverView() {
      if (this._panelCoverHovered) {
        this._coverBg.hide();
        this._coverPlaceholderIcon.hide();
        this._coverPlayIcon.show();
      } else if (this._panelHasCover) {
        this._coverBg.show();
        this._coverPlaceholderIcon.hide();
        this._coverPlayIcon.hide();
      } else {
        this._coverBg.show();
        this._coverPlaceholderIcon.show();
        this._coverPlayIcon.hide();
      }
    }

    _applyAlbumArtGrayscale() {
      const enabled = this._settings.get_boolean(ALBUM_ART_GRAYSCALE_KEY);
      if (enabled) {
        if (!this._panelCoverDesaturate) {
          this._panelCoverDesaturate = new Clutter.DesaturateEffect({ factor: 1.0 });
          this._coverBg.add_effect(this._panelCoverDesaturate);
        }
      } else if (this._panelCoverDesaturate) {
        this._coverBg.remove_effect(this._panelCoverDesaturate);
        this._panelCoverDesaturate = null;
      }
      this._cardItem.setGrayscale(enabled);
    }

    override destroy(): void {
      if (!this._watchIds) {
        super.destroy();
        return;
      }

      for (const [player, id] of this._watchIds) {
        player.disconnect(id);
        this._watchIds.delete(player);
      }

      if (this._activePlayer && this._playerChangedId) {
        this._activePlayer.disconnect(this._playerChangedId);
        this._playerChangedId = 0;
      }

      if (this._grayscaleSettingsId) {
        this._settings.disconnect(this._grayscaleSettingsId);
        this._grayscaleSettingsId = 0;
      }
      if (this._hideWhenNoPlayersSettingsId) {
        this._settings.disconnect(this._hideWhenNoPlayersSettingsId);
        this._hideWhenNoPlayersSettingsId = 0;
      }
      if (this._panelLabelScrollSettingsId) {
        this._settings.disconnect(this._panelLabelScrollSettingsId);
        this._panelLabelScrollSettingsId = 0;
      }
      if (this._playerFilterModeSettingsId) {
        this._settings.disconnect(this._playerFilterModeSettingsId);
        this._playerFilterModeSettingsId = 0;
      }
      if (this._playerFilterWhitelistSettingsId) {
        this._settings.disconnect(this._playerFilterWhitelistSettingsId);
        this._playerFilterWhitelistSettingsId = 0;
      }
      if (this._panelScroller) {
        this._panelScroller.destroy();
        this._panelScroller = null;
      }
      if (this._panelCoverDesaturate) {
        this._coverBg.remove_effect(this._panelCoverDesaturate);
        this._panelCoverDesaturate = null;
      }

      super.destroy();
    }
  },
);
