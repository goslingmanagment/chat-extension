import { describe, expect, it } from 'vitest';
import { registrationAge } from './registration';

describe('[host:fansly] registration age', () => {
  it('[FX-002] uses whole calendar units in both languages, including month and year boundaries', () => {
    const at = new Date(2024, 1, 15, 12).getTime();
    expect(registrationAge(at, at, 'ru')).toBe('сегодня');
    expect(registrationAge(at, new Date(2024, 1, 16).getTime(), 'ru')).toBe('вчера');
    expect(registrationAge(at, new Date(2024, 2, 14).getTime(), 'en')).toBe('28 days ago');
    expect(registrationAge(at, new Date(2024, 2, 15).getTime(), 'ru')).toBe('1 месяц назад');
    expect(registrationAge(at, new Date(2025, 1, 14).getTime(), 'en')).toBe('11 months ago');
    expect(registrationAge(at, new Date(2025, 1, 15).getTime(), 'ru')).toBe('1 год назад');
  });
});
