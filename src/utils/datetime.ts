
const getFormatterPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string => {
  return parts.find((entry) => entry.type === type)?.value ?? "";
};

export const getZonedDateDetails = (date: Date, timeZone: string = process.env.APP_TIMEZONE ?? "UTC") => {
  const dateParts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  const timeParts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, hourCycle: "h23" }).formatToParts(date);
  return {
    year: getFormatterPart(dateParts, "year"),
    monthNumber: getFormatterPart(dateParts, "month"),
    dayNumber: getFormatterPart(dateParts, "day"),
    weekday: getFormatterPart(dateParts, "weekday"),
    monthName: new Intl.DateTimeFormat("en-US", { month: "long", timeZone }).format(date),
    hour: getFormatterPart(timeParts, "hour"),
    minute: getFormatterPart(timeParts, "minute"),
    second: getFormatterPart(timeParts, "second"),
  };
};

export const formatCurrentTime = (date: Date, timeZone: string = process.env.APP_TIMEZONE ?? "UTC"): string => {
  const { year, monthNumber, dayNumber, hour, minute, second } = getZonedDateDetails(date, timeZone);
  return `${year}-${monthNumber}-${dayNumber}T${hour}:${minute}:${second} ${timeZone}`;
};

export const toUtcDayRange = (
  date: Date,
  timeZone: string = process.env.APP_TIMEZONE ?? "UTC",
): { since: string; until: string } => {
  const { year, monthNumber, dayNumber } = getZonedDateDetails(date, timeZone);

  return {
    since: `${year}-${monthNumber}-${dayNumber}T00:00:00Z`,
    until: `${year}-${monthNumber}-${dayNumber}T23:59:59Z`,
  };
};

export const resolveRelativeDayRange = (
  triggerText: string,
  now = new Date(),
  timeZone: string = process.env.APP_TIMEZONE ?? "UTC",
): { since: string; until: string } => {
  const normalized = triggerText.toLowerCase();

  if (/\btoday\b/.test(normalized)) {
    return toUtcDayRange(now, timeZone);
  }

  if (/\btomorrow\b/.test(normalized)) {
    return toUtcDayRange(new Date(now.getTime() + 24 * 60 * 60 * 1000), timeZone);
  }

  return toUtcDayRange(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);
};
