/**
 * StasisPivot - pure panel layout.
 *
 * The settings accessor is passed in, not imported, so this file has no engine
 * dependency and tests/layout_test.mjs can execute it on a PC build host.
 */

import {
  offsetFrom,
  straightLine,
  horizontalDistance,
  formatCoord,
  formatDecimal,
  formatSigned,
} from "./geom.js";
import { colorize, toArgb } from "./colors.js";

const CHAR_WIDTH = 6; // default glyph advance in the 9px UI font
const LINE_HEIGHT = 10;
const PADDING_X = 4;
const PADDING_Y = 3;

/**
 * Snapshot of the panel-relevant settings.
 * @param {(key: string) => any} read settings accessor
 */
export function hudSettings(read) {
  return {
    hud_show_header: read("hud_show_header"),
    hud_show_delta: read("hud_show_delta"),
    hud_show_distance: read("hud_show_distance"),
    hud_always: read("hud_always"),
    hud_max_distance: read("hud_max_distance"),
    hud_scale: read("hud_scale"),
    hud_offset_x: read("hud_offset_x"),
    hud_offset_y: read("hud_offset_y"),
    hud_bg_color: read("hud_bg_color"),
    hud_bg_alpha: read("hud_bg_alpha"),
    hud_outline_color: read("hud_outline_color"),
    hud_outline_alpha: read("hud_outline_alpha"),
    hud_outline_width: read("hud_outline_width"),
    hud_corner_radius: read("hud_corner_radius"),
    hud_color_x: read("hud_color_x"),
    hud_color_y: read("hud_color_y"),
    hud_color_z: read("hud_color_z"),
    hud_color_s: read("hud_color_s"),
    hud_color_delta: read("hud_color_delta"),
    hud_color_text: read("hud_color_text"),
    hud_color_header: read("hud_color_header"),
    hud_actionbar: read("hud_actionbar"),
    hud_actionbar_stacked: read("hud_actionbar_stacked"),
  };
}

/**
 * Pure layout builder.
 * @param {{source:{x:number,y:number,z:number}, playerLocation:{x:number,y:number,z:number}, settings:Record<string,any>}} state
 */
export function buildLayout(state) {
  const { source, playerLocation, settings: cfg } = state;
  const offset = offsetFrom(playerLocation, source);
  const s = straightLine(offset);
  const rows = [];

  if (cfg.hud_show_header) {
    rows.push([
      { text: "STASIS PIVOT", color: cfg.hud_color_header },
      { text: "  ", color: cfg.hud_color_text },
      {
        text: `${formatCoord(source.x)} ${formatCoord(source.y)} ${formatCoord(source.z)}`,
        color: cfg.hud_color_text,
      },
    ]);
  }

  rows.push([
    { text: "X ", color: cfg.hud_color_text },
    { text: formatCoord(source.x), color: cfg.hud_color_x },
    { text: "  Y ", color: cfg.hud_color_text },
    { text: formatCoord(source.y), color: cfg.hud_color_y },
    { text: "  Z ", color: cfg.hud_color_text },
    { text: formatCoord(source.z), color: cfg.hud_color_z },
    { text: "  S ", color: cfg.hud_color_text },
    {
      text: cfg.hud_show_distance ? formatDecimal(s, 2) : "--",
      color: cfg.hud_color_s,
    },
  ]);

  if (cfg.hud_show_delta) {
    rows.push([
      { text: "dX ", color: cfg.hud_color_text },
      { text: formatSigned(offset.x), color: cfg.hud_color_delta },
      { text: "  dY ", color: cfg.hud_color_text },
      { text: formatSigned(offset.y), color: cfg.hud_color_delta },
      { text: "  dZ ", color: cfg.hud_color_text },
      { text: formatSigned(offset.z), color: cfg.hud_color_delta },
    ]);
  }

  const columns = Math.max(
    ...rows.map((row) => row.reduce((total, span) => total + span.text.length, 0)),
  );

  const scale = cfg.hud_scale;
  const box = {
    x: cfg.hud_offset_x,
    y: cfg.hud_offset_y,
    w: columns * CHAR_WIDTH * scale + PADDING_X * 2 * scale,
    h: rows.length * LINE_HEIGHT * scale + PADDING_Y * 2 * scale,
  };

  return {
    rows,
    columns,
    box,
    scale,
    offset,
    straightLine: s,
    horizontalDistance: horizontalDistance(offset),
    visible: cfg.hud_always || s <= cfg.hud_max_distance,
  };
}

/** Frame the panel using box drawing characters (action bar renderer). */
export function toActionBar(layout, cfg) {
  const width = layout.columns;
  const rule = "─".repeat(width + 2);
  const top = colorize(cfg.hud_outline_color, `╭${rule}╮`);
  const bottom = colorize(cfg.hud_outline_color, `╰${rule}╯`);
  const lines = layout.rows.map((row) => {
    const text = row.map((span) => colorize(span.color, span.text)).join("");
    const plain = row.reduce((total, span) => total + span.text.length, 0);
    const fill = " ".repeat(Math.max(0, width - plain));
    return `${colorize(cfg.hud_outline_color, "│")} ${text}${fill} ${colorize(cfg.hud_outline_color, "│")}`;
  });

  if (!cfg.hud_actionbar_stacked) {
    // One line keeps the vanilla HUD tidy; the outline becomes a bracket pair.
    const single = layout.rows
      .map((row) => row.map((span) => colorize(span.color, span.text)).join(""))
      .join(colorize(cfg.hud_color_text, " │ "));
    return `${colorize(cfg.hud_outline_color, "╡")} ${single} ${colorize(cfg.hud_outline_color, "╞")}`;
  }

  return [top, ...lines, bottom].join("\n");
}

/**
 * Build the native overlay command list. The Levi bridge understands a tiny
 * JSON command set; see scripts/levi.js for the transport.
 */
export function toOverlayCommands(layout, cfg) {
  const argb = toArgb; // 0xAARRGGBB, the layout the HUD overlay expects
  const { box, scale } = layout;
  /** @type {import("./levi.js").OverlayCommand[]} */
  const commands = [];

  if (cfg.hud_bg_alpha > 0) {
    commands.push({ op: "rect", x: box.x, y: box.y, w: box.w, h: box.h, color: argb(cfg.hud_bg_color, cfg.hud_bg_alpha) });
  }

  if (cfg.hud_outline_width > 0 && cfg.hud_outline_alpha > 0) {
    const color = argb(cfg.hud_outline_color, cfg.hud_outline_alpha);
    const width = cfg.hud_outline_width * scale;
    const radius = Math.max(0, Math.min(cfg.hud_corner_radius * scale, Math.min(box.w, box.h) / 2));
    const x0 = box.x;
    const y0 = box.y;
    const x1 = box.x + box.w;
    const y1 = box.y + box.h;
    commands.push(
      { op: "line", x: x0 + radius, y: y0, x3: x1 - radius, y3: y0, color, size: width },
      { op: "line", x: x0 + radius, y: y1, x3: x1 - radius, y3: y1, color, size: width },
      { op: "line", x: x0, y: y0 + radius, x3: x0, y3: y1 - radius, color, size: width },
      { op: "line", x: x1, y: y0 + radius, x3: x1, y3: y1 - radius, color, size: width },
    );
    if (radius > 0.5) {
      const corners = [
        { cx: x0 + radius, cy: y0 + radius, from: Math.PI, to: Math.PI * 1.5 },
        { cx: x1 - radius, cy: y0 + radius, from: Math.PI * 1.5, to: Math.PI * 2 },
        { cx: x1 - radius, cy: y1 - radius, from: 0, to: Math.PI * 0.5 },
        { cx: x0 + radius, cy: y1 - radius, from: Math.PI * 0.5, to: Math.PI },
      ];
      const segments = 6;
      for (const corner of corners) {
        let previous = {
          x: corner.cx + Math.cos(corner.from) * radius,
          y: corner.cy + Math.sin(corner.from) * radius,
        };
        for (let step = 1; step <= segments; step += 1) {
          const angle = corner.from + ((corner.to - corner.from) * step) / segments;
          const point = {
            x: corner.cx + Math.cos(angle) * radius,
            y: corner.cy + Math.sin(angle) * radius,
          };
          commands.push({ op: "line", x: previous.x, y: previous.y, x3: point.x, y3: point.y, color, size: width });
          previous = point;
        }
      }
    }
  }

  let y = box.y + PADDING_Y * scale;
  for (const row of layout.rows) {
    let x = box.x + PADDING_X * scale;
    for (const span of row) {
      commands.push({ op: "text", x, y, text: span.text, color: argb(span.color, 1), size: scale });
      x += span.text.length * CHAR_WIDTH * scale;
    }
    y += LINE_HEIGHT * scale;
  }

  return commands;
}
