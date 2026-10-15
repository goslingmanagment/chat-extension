/** The native network capability stays in hub; the composition supplies it as a port. */
export const directFetch = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);
