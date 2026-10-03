// alarms (architecture.md §3 `permissions: alarms`): timers that survive the
// event page unloading — telemetry flush, result TTL sweeps, recap-save
// retries. `onAlarm` must be wired synchronously at background start so the
// alarm itself can wake the page (§7 «Фон и выгрузка»).

import { defaultBrowser, type AlarmCreateInfoApi, type BrowserApi } from './browser-api';

export interface AlarmSchedule {
  /** Fire once after this delay. */
  readonly delayMs?: number;
  /** Fire once at this wall-clock instant. */
  readonly at?: number;
  /** Then repeat with this period. */
  readonly periodMs?: number;
}

export interface AlarmsPort {
  set(name: string, schedule: AlarmSchedule): Promise<boolean>;
  clear(name: string): Promise<boolean>;
  /** When the named alarm is due next; null — not scheduled. */
  next(name: string): Promise<number | null>;
  onAlarm(listener: (name: string, scheduledTime: number) => void): () => void;
}

const MINUTE_MS = 60_000;

export function alarmCreateInfo(schedule: AlarmSchedule): AlarmCreateInfoApi {
  const info: AlarmCreateInfoApi = {};
  if (schedule.at !== undefined) info.when = schedule.at;
  else if (schedule.delayMs !== undefined) info.delayInMinutes = Math.max(0, schedule.delayMs) / MINUTE_MS;
  if (schedule.periodMs !== undefined) info.periodInMinutes = Math.max(0, schedule.periodMs) / MINUTE_MS;
  return info;
}

export function createAlarms(api: BrowserApi = defaultBrowser()): AlarmsPort {
  return {
    async set(name, schedule) {
      try {
        await api.alarms.create(name, alarmCreateInfo(schedule));
        return true;
      } catch {
        return false;
      }
    },
    async clear(name) {
      try {
        return await api.alarms.clear(name);
      } catch {
        return false;
      }
    },
    async next(name) {
      try {
        const alarm = await api.alarms.get(name);
        return alarm ? alarm.scheduledTime : null;
      } catch {
        return null;
      }
    },
    onAlarm(listener) {
      const wrapped = (alarm: { readonly name: string; readonly scheduledTime: number }): void => listener(alarm.name, alarm.scheduledTime);
      api.alarms.onAlarm.addListener(wrapped);
      return () => api.alarms.onAlarm.removeListener(wrapped);
    },
  };
}
