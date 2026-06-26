/**
 * Next follow-up send instants (IANA zones via Intl — no extra npm deps).
 * Rules: 0-day = same local calendar day after kickoff if sendAt > kickoff, else next eligible day;
 * N>0 = add N eligible local days; skip US federal holidays when schedule.skipHolidays; optional DOW filter.
 */

/** US federal holidays (fixed). Floating holidays computed in `zone`. */
const FIXED_HOLIDAYS = [
  {month: 1, day: 1},
  {month: 6, day: 19},
  {month: 7, day: 4},
  {month: 11, day: 11},
  {month: 12, day: 25},
];

/**
 * @param {number} tMs
 * @param {string} timeZone
 */
function formatInZone(tMs, timeZone) {
  const d = new Date(tMs);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type) => {
    const x = parts.find((p) => p.type === type);
    if (!x) {
      return 0;
    }
    return parseInt(String(x.value).replace(/\D/g, ""), 10) || 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Find UTC ms for a civil wall-clock in `timeZone` (1-minute scan around local noon).
 * @param {number} y
 * @param {number} mo
 * @param {number} d
 * @param {number} hour
 * @param {number} minute
 * @param {string} timeZone
 */
function findWallUtc(y, mo, d, hour, minute, timeZone) {
  const base = Date.UTC(y, mo - 1, d, 12, 0, 0, 0);
  for (let delta = -42 * 3600000; delta <= 42 * 3600000; delta += 60000) {
    const t = base + delta;
    const p = formatInZone(t, timeZone);
    if (p.year === y && p.month === mo && p.day === d && p.hour === hour && p.minute === minute) {
      return t;
    }
  }
  return base;
}

/**
 * @param {number} y
 * @param {number} mo
 * @param {number} d
 * @param {string} timeZone
 */
function isoCal(y, mo, d) {
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

/**
 * UI weekday 0=Sun … 6=Sat at civil noon in zone.
 * @param {number} y
 * @param {number} mo
 * @param {number} d
 * @param {string} timeZone
 */
function weekdayUiAtNoon(y, mo, d, timeZone) {
  const t = findWallUtc(y, mo, d, 12, 0, timeZone);
  const wd = new Intl.DateTimeFormat("en-US", {timeZone, weekday: "short"}).format(new Date(t));
  const map = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
  return map[String(wd).slice(0, 3)] ?? 0;
}

/**
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} weekdayUi 0=Sun
 * @param {number} n 1-based nth occurrence
 * @param {string} timeZone
 */
function nthWeekdayOfMonthIso(year, month, weekdayUi, n, timeZone) {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    try {
      const tProbe = findWallUtc(year, month, day, 12, 0, timeZone);
      const p = formatInZone(tProbe, timeZone);
      if (p.month !== month) {
        continue;
      }
      if (weekdayUiAtNoon(year, month, day, timeZone) === weekdayUi) {
        count++;
        if (count === n) {
          return isoCal(year, month, day);
        }
      }
    } catch {
      /**/
    }
  }
  return null;
}

/**
 * @param {number} year
 * @param {string} timeZone
 */
function lastMondayOfMayIso(year, timeZone) {
  for (let day = 31; day >= 1; day--) {
    try {
      const tProbe = findWallUtc(year, 5, day, 12, 0, timeZone);
      const p = formatInZone(tProbe, timeZone);
      if (p.month !== 5) {
        continue;
      }
      if (weekdayUiAtNoon(year, 5, day, timeZone) === 1) {
        return isoCal(year, 5, day);
      }
    } catch {
      /**/
    }
  }
  return null;
}

/**
 * @param {number} year
 * @param {string} timeZone
 */
function fourthThursdayOfNovemberIso(year, timeZone) {
  let thu = 0;
  for (let day = 1; day <= 30; day++) {
    if (weekdayUiAtNoon(year, 11, day, timeZone) === 4) {
      thu++;
      if (thu === 4) {
        return isoCal(year, 11, day);
      }
    }
  }
  return null;
}

/**
 * @param {number} year
 * @param {string} zone
 */
function usFederalHolidayDateSet(year, zone) {
  const z = zone || "America/New_York";
  const out = new Set();
  for (const h of FIXED_HOLIDAYS) {
    out.add(isoCal(year, h.month, h.day));
  }
  const a = nthWeekdayOfMonthIso(year, 1, 1, 3, z);
  const b = nthWeekdayOfMonthIso(year, 2, 1, 3, z);
  const c = lastMondayOfMayIso(year, z);
  const d = nthWeekdayOfMonthIso(year, 9, 1, 1, z);
  const e = nthWeekdayOfMonthIso(year, 10, 1, 2, z);
  const f = fourthThursdayOfNovemberIso(year, z);
  [a, b, c, d, e, f].forEach((x) => {
    if (x) {
      out.add(x);
    }
  });
  return out;
}

/**
 * @param {number} luxonWeekday unused kept for API compat
 */
function luxonWeekdayToUi(luxonWeekday) {
  return luxonWeekday === 7 ? 0 : luxonWeekday;
}

/**
 * @param {number} y
 * @param {number} mo
 * @param {number} d
 * @param {boolean} skipHolidays
 * @param {number[] | null} sendOnDaysOfWeek
 * @param {string} zone
 */
function isEligibleCivilDay(y, mo, d, skipHolidays, sendOnDaysOfWeek, zone) {
  const holidays = skipHolidays ? usFederalHolidayDateSet(y, zone) : new Set();
  const id = isoCal(y, mo, d);
  if (skipHolidays && holidays.has(id)) {
    return false;
  }
  if (sendOnDaysOfWeek && sendOnDaysOfWeek.length > 0) {
    const ui = weekdayUiAtNoon(y, mo, d, zone);
    if (!sendOnDaysOfWeek.includes(ui)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {number} y
 * @param {number} mo
 * @param {number} d
 * @param {string} zone
 */
function addOneCivilDay(y, mo, d, zone) {
  let t = findWallUtc(y, mo, d, 0, 0, zone);
  for (let step = 1; step <= 30; step++) {
    t += 3600000;
    const p = formatInZone(t, zone);
    if (p.year !== y || p.month !== mo || p.day !== d) {
      return {y: p.year, m: p.month, d: p.day};
    }
  }
  for (let m = 1; m <= 3000; m++) {
    t += 60000;
    const p2 = formatInZone(t, zone);
    if (p2.year !== y || p2.month !== mo || p2.day !== d) {
      return {y: p2.year, m: p2.month, d: p2.day};
    }
  }
  const fb = new Date(Date.UTC(y, mo - 1, d + 1, 12, 0, 0, 0));
  return {y: fb.getUTCFullYear(), m: fb.getUTCMonth() + 1, d: fb.getUTCDate()};
}

/**
 * @param {number} y
 * @param {number} mo
 * @param {number} d
 * @param {boolean} skipHolidays
 * @param {number[] | null} sendOnDaysOfWeek
 * @param {string} zone
 */
function nextEligibleCivilFrom(y, mo, d, skipHolidays, sendOnDaysOfWeek, zone) {
  let cur = {y, m: mo, d};
  for (let i = 0; i < 400; i++) {
    if (isEligibleCivilDay(cur.y, cur.m, cur.d, skipHolidays, sendOnDaysOfWeek, zone)) {
      return cur;
    }
    cur = addOneCivilDay(cur.y, cur.m, cur.d, zone);
  }
  return {y, m: mo, d};
}

/**
 * @param {string} localTime
 * @param {{ y: number, m: number, d: number }} civil
 * @param {string} zone
 */
function atLocalTimeOnCivil(civil, localTime, zone) {
  const parts = String(localTime || "09:00").trim().split(":");
  const hh = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 9));
  const mm = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
  return findWallUtc(civil.y, civil.m, civil.d, hh, mm, zone);
}

/**
 * @param {string|Date|import('firebase-admin').firestore.Timestamp} anchorSentAt
 * @param {{ ifNoReplyAfterDays?: number, sendAtLocal?: string, sendAtTimeZone?: string, stage?: number }} stage
 * @param {{ skipHolidays?: boolean, sendOnDaysOfWeek?: number[] | null, chooseSpecificDays?: boolean }} schedule
 * @returns {string} ISO UTC
 */
function computeNextStageSendAt(anchorSentAt, stage, schedule) {
  const zone = (stage && stage.sendAtTimeZone) || "America/New_York";
  const localTime = (stage && stage.sendAtLocal) || "09:00";
  const days = Math.max(0, parseInt(String(stage && stage.ifNoReplyAfterDays != null ? stage.ifNoReplyAfterDays : 0), 10) || 0);
  const skipHolidays = !!(schedule && schedule.skipHolidays);
  const sendOnDaysOfWeek =
    schedule && schedule.chooseSpecificDays && Array.isArray(schedule.sendOnDaysOfWeek)
      ? schedule.sendOnDaysOfWeek
      : null;

  let anchorMs;
  if (typeof anchorSentAt === "string") {
    anchorMs = new Date(anchorSentAt).getTime();
  } else if (anchorSentAt && typeof anchorSentAt.toDate === "function") {
    anchorMs = anchorSentAt.toDate().getTime();
  } else {
    anchorMs = new Date(anchorSentAt).getTime();
  }

  /** GMass-style: wait N minutes after prior touch (float ok). Overrides calendar day + time when set. */
  const delayRaw = stage && stage.delayMinutesAfterPrior;
  if (delayRaw != null && delayRaw !== "") {
    const mins = parseFloat(String(delayRaw));
    if (!Number.isNaN(mins) && mins >= 0) {
      const extraMs = mins === 0 ? 45000 : mins * 60000;
      return new Date(anchorMs + extraMs).toISOString();
    }
  }

  const kickoffParts = formatInZone(anchorMs, zone);
  const kickoffInstant = anchorMs;

  if (days === 0) {
    const dayCivil = {y: kickoffParts.year, m: kickoffParts.month, d: kickoffParts.day};
    let candidateMs = atLocalTimeOnCivil(dayCivil, localTime, zone);
    if (
      candidateMs > kickoffInstant &&
      isEligibleCivilDay(dayCivil.y, dayCivil.m, dayCivil.d, skipHolidays, sendOnDaysOfWeek, zone)
    ) {
      return new Date(candidateMs).toISOString();
    }
    let next = addOneCivilDay(dayCivil.y, dayCivil.m, dayCivil.d, zone);
    next = nextEligibleCivilFrom(next.y, next.m, next.d, skipHolidays, sendOnDaysOfWeek, zone);
    candidateMs = atLocalTimeOnCivil(next, localTime, zone);
    return new Date(candidateMs).toISOString();
  }

  let cur = {y: kickoffParts.year, m: kickoffParts.month, d: kickoffParts.day};
  let remaining = days;
  while (remaining > 0) {
    cur = addOneCivilDay(cur.y, cur.m, cur.d, zone);
    if (isEligibleCivilDay(cur.y, cur.m, cur.d, skipHolidays, sendOnDaysOfWeek, zone)) {
      remaining--;
    }
  }
  cur = nextEligibleCivilFrom(cur.y, cur.m, cur.d, skipHolidays, sendOnDaysOfWeek, zone);
  const candidateMs = atLocalTimeOnCivil(cur, localTime, zone);
  return new Date(candidateMs).toISOString();
}

/**
 * @param {object[]} stages
 * @param {number} nextStageIndex
 */
function getStageBySequenceIndex(stages, nextStageIndex) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return null;
  }
  const sorted = stages.slice().sort((a, b) => (a.stage || 0) - (b.stage || 0));
  const idx = Math.max(1, Math.min(sorted.length, parseInt(String(nextStageIndex), 10) || 1)) - 1;
  return sorted[idx] || null;
}

module.exports = {
  computeNextStageSendAt,
  getStageBySequenceIndex,
  luxonWeekdayToUi,
};
