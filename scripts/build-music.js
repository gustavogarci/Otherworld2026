#!/usr/bin/env node
/**
 * Build music.json from the Dancing Decibels schedule export.
 *
 * The festival's DJ-set lineup is maintained by Dancing Decibels and
 * shared as a Google Sheet. We pull the CSV (re-downloadable any time
 * from the published sheet) and normalize each performance row into the
 * exact same event shape that events.json uses, so the existing UI
 * (cards, By Day, By Stage, Map, favorites, genre filters) renders it
 * with zero extra code.
 *
 * Usage:
 *   # Refresh: download the CSV from the sheet, then:
 *   node scripts/build-music.js [input.csv] [output.json]
 *
 * Defaults: input = music.csv, output = music.json (both at repo root).
 *
 * The script also accepts a Dancing Decibels JSON export (an object with
 * an `artistPerformanceList`) if the input path ends in .json — handy if
 * Ben sends a one-off JSON instead of the sheet.
 *
 * Source columns (CSV) / fields (JSON):
 *   performanceId, name, stageName, startTime, endTime,
 *   description, genreList, socialList
 *
 * Mapping to the events.json event shape:
 *   owner / _entry.name = stageName (display name kept as-is)
 *   ownerType           = "sound_stage"
 *   title               = name (artist)
 *   description         = description
 *   tags                = genreList split on commas (drives genre chips)
 *   socialList          = links array
 *   day                 = weekday of startTime's date (midnight boundary)
 *   startTime/endTime   = "HH:MM" (zero-padded)
 *   durationHours       = end - start, in hours
 *   crossesMidnight     = end calendar date is after start calendar date
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DAY_ORDER = ["Thursday", "Friday", "Saturday", "Sunday", "Monday"];
const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

// ── Minimal RFC-4180 CSV parser ───────────────────────────────────────
// Handles quoted fields, escaped quotes (""), embedded commas, and
// embedded newlines. Returns an array of row arrays.
function parseCsv(text) {
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (c === "\r") {
      // Swallow CR; the following LF (if any) closes the row.
      if (text[i + 1] !== "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
      }
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row (file may not end in a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvToRecords(text) {
  const rows = parseCsv(text).filter(r => r.some(c => c.trim() !== ""));
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(cells => {
    const rec = {};
    header.forEach((h, i) => { rec[h] = (cells[i] || "").trim(); });
    return rec;
  });
}

// ── Field normalizers ─────────────────────────────────────────────────
function splitList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

// Parse "YYYY-MM-DD H:MM" (or "...HH:MM", space or 'T' separated) into a
// plain {y,mo,d,h,mi} struct. We deliberately avoid the local Date
// timezone: the times are festival wall-clock times and must not shift.
function parseStamp(raw) {
  const s = String(raw || "").trim().replace("T", " ");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return {
    y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5],
  };
}

function weekdayOf(st) {
  // getUTCDay on a UTC date avoids any local-timezone drift.
  const idx = new Date(Date.UTC(st.y, st.mo - 1, st.d)).getUTCDay();
  return WEEKDAYS[idx];
}

function hhmm(st) {
  return String(st.h).padStart(2, "0") + ":" + String(st.mi).padStart(2, "0");
}

function toMillis(st) {
  return Date.UTC(st.y, st.mo - 1, st.d, st.h, st.mi);
}

function buildEvent(rec) {
  const start = parseStamp(rec.startTime);
  const end = parseStamp(rec.endTime);
  if (!start) return null;

  const day = weekdayOf(start);
  let durationHours = null;
  let crossesMidnight = false;
  if (end) {
    durationHours = Math.round(((toMillis(end) - toMillis(start)) / 3600000) * 100) / 100;
    crossesMidnight = (end.y !== start.y) || (end.mo !== start.mo) || (end.d !== start.d);
  }

  const stageName = (rec.stageName || "").trim();
  const ev = {
    owner: stageName,
    ownerType: "sound_stage",
    title: (rec.name || "").trim(),
    description: (rec.description || "").trim(),
    day,
    startTime: hhmm(start),
    endTime: end ? hhmm(end) : "",
    durationHours,
    crossesMidnight,
    tags: splitList(rec.genreList),
    socialList: splitList(rec.socialList),
    rawTimeText: `${day} ${hhmm(start)}${end ? " - " + hhmm(end) : ""}`,
  };
  if (rec.performanceId) ev.performanceId = String(rec.performanceId).trim();
  return ev;
}

function dayRank(d) {
  const i = DAY_ORDER.indexOf(d);
  return i === -1 ? DAY_ORDER.length : i;
}

function timeRank(ev) {
  const m = /^(\d{2}):(\d{2})$/.exec(ev.startTime || "");
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}

// ── Main ──────────────────────────────────────────────────────────────
function main() {
  const inPath = process.argv[2] || "music.csv";
  const outPath = process.argv[3] || "music.json";

  if (!fs.existsSync(inPath)) {
    console.error(`Input not found: ${inPath}`);
    console.error("Download the CSV from the Dancing Decibels sheet, then:");
    console.error("  node scripts/build-music.js music.csv");
    process.exit(1);
  }

  const raw = fs.readFileSync(inPath, "utf8");
  let records;
  // Captures the live feed's identifying fields (when the input is the
  // Dancing Decibels event JSON) so the changelog can show which upstream
  // version a given music.json was built from. Stays null for CSV input.
  let sourceMeta = null;
  const isJson = inPath.toLowerCase().endsWith(".json");
  if (isJson) {
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.artistPerformanceList || []);
    if (!Array.isArray(data)) {
      sourceMeta = {
        eventId: data.eventId || null,
        eventYear: data.eventYear || null,
        yearDataVersion: data.yearDataVersion || null,
        artistVersion: data.artistVersion || null,
      };
    }
    records = list.map(p => ({
      performanceId: p.performanceId || "",
      name: p.name || "",
      stageName: p.stageName || "",
      startTime: p.startTime || "",
      endTime: p.endTime || "",
      description: p.description || "",
      // JSON gives proper arrays; re-join so the shared splitter handles both.
      genreList: Array.isArray(p.genreList) ? p.genreList.join(",") : (p.genreList || ""),
      socialList: Array.isArray(p.socialList) ? p.socialList.join(",") : (p.socialList || ""),
    }));
  } else {
    records = csvToRecords(raw);
  }

  // Group events by stage, preserving first-seen stage order.
  const byStage = new Map();
  let eventCount = 0;
  let crossCount = 0;
  for (const rec of records) {
    const ev = buildEvent(rec);
    if (!ev || !ev.owner) continue;
    if (!byStage.has(ev.owner)) byStage.set(ev.owner, []);
    byStage.get(ev.owner).push(ev);
    eventCount++;
    if (ev.crossesMidnight) crossCount++;
  }

  const entries = [];
  for (const [stage, events] of byStage) {
    events.sort((a, b) => (dayRank(a.day) - dayRank(b.day)) || (timeRank(a) - timeRank(b)));
    entries.push({
      name: stage,
      type: "sound_stage",
      events,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const dayCounts = {};
  for (const d of DAY_ORDER) dayCounts[d] = 0;
  for (const e of entries) for (const ev of e.events) {
    if (dayCounts[ev.day] !== undefined) dayCounts[ev.day]++;
  }

  const out = {
    metadata: {
      source: isJson
        ? "Dancing Decibels — Otherworld live event JSON"
        : "Dancing Decibels — Otherworld Schedule CSV",
      attribution: "Schedule data courtesy of Dancing Decibels (dancingdecibels.com).",
      generatedAt: new Date().toISOString(),
      eventCount,
      entryCount: entries.length,
      crossesMidnightCount: crossCount,
      countsByDay: dayCounts,
      ...(sourceMeta ? { upstream: sourceMeta } : {}),
    },
    entries,
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
  console.log(`  events:  ${eventCount}`);
  console.log(`  stages:  ${entries.length}`);
  console.log(`  crosses midnight: ${crossCount}`);
  console.log(`  by day:  ${DAY_ORDER.map(d => `${d.slice(0,3)}${dayCounts[d]}`).join(" ")}`);
}

main();
