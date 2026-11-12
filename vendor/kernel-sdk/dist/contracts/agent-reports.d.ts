/**
 * Agent reports (ecosystem plan §2 «Канал трафика», package O): a named
 * markdown page an agent key publishes and people read inside the app — the
 * traffic routine's daily summary first, the customs board and the others
 * later. One row per slug: publishing the same slug again replaces the page
 * and counts its version. The owner reads every report; a team lead only the
 * ones the agent opened to team leads; a chatter none. The body is the
 * agent's text: the app renders it with its own typography and never
 * reformats the money, dates or periods in it.
 */
import { z } from "zod";
/** Lowercase words and hyphens: `traffic`, `customs-board`. */
export declare const AGENT_REPORT_SLUG_PATTERN: RegExp;
export declare const agentReportSlugSchema: z.ZodString;
/** Where a report belongs in the owner's place. */
export declare const AGENT_REPORT_SECTIONS: readonly ["traffic", "team", "content", "system"];
export declare const agentReportSectionSchema: z.ZodEnum<{
    content: "content";
    system: "system";
    team: "team";
    traffic: "traffic";
}>;
export type AgentReportSection = z.infer<typeof agentReportSectionSchema>;
/** The body's ceiling, in UTF-8 bytes (the database repeats it). */
export declare const AGENT_REPORT_BODY_MAX_BYTES: number;
/** «Valid for» runs from an hour to a year. */
export declare const AGENT_REPORT_VALID_HOURS_MAX: number;
export declare function agentReportBodyBytes(body: string): number;
export declare const agentReportPutBodySchema: z.ZodObject<{
    title: z.ZodString;
    section: z.ZodEnum<{
        content: "content";
        system: "system";
        team: "team";
        traffic: "traffic";
    }>;
    body: z.ZodString;
    teamLeads: z.ZodOptional<z.ZodBoolean>;
    validHours: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strict>;
export type AgentReportPutBody = z.infer<typeof agentReportPutBodySchema>;
/** What a report is, without its body. */
export declare const agentReportMetaSchema: z.ZodObject<{
    slug: z.ZodString;
    title: z.ZodString;
    section: z.ZodEnum<{
        content: "content";
        system: "system";
        team: "team";
        traffic: "traffic";
    }>;
    teamLeads: z.ZodBoolean;
    validHours: z.ZodNullable<z.ZodNumber>;
    version: z.ZodNumber;
    publishedAt: z.ZodString;
    publishedBy: z.ZodNullable<z.ZodObject<{
        agentKeyId: z.ZodNumber;
        name: z.ZodString;
    }, z.core.$strip>>;
    bytes: z.ZodNumber;
    staleAt: z.ZodNullable<z.ZodString>;
    stale: z.ZodBoolean;
}, z.core.$strip>;
export type AgentReportMeta = z.infer<typeof agentReportMetaSchema>;
export declare const agentReportPutResponseSchema: z.ZodObject<{
    report: z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        section: z.ZodEnum<{
            content: "content";
            system: "system";
            team: "team";
            traffic: "traffic";
        }>;
        teamLeads: z.ZodBoolean;
        validHours: z.ZodNullable<z.ZodNumber>;
        version: z.ZodNumber;
        publishedAt: z.ZodString;
        publishedBy: z.ZodNullable<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        bytes: z.ZodNumber;
        staleAt: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
    }, z.core.$strip>;
    changed: z.ZodBoolean;
}, z.core.$strip>;
export type AgentReportPutResponse = z.infer<typeof agentReportPutResponseSchema>;
export declare const agentReportListResponseSchema: z.ZodObject<{
    reports: z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        section: z.ZodEnum<{
            content: "content";
            system: "system";
            team: "team";
            traffic: "traffic";
        }>;
        teamLeads: z.ZodBoolean;
        validHours: z.ZodNullable<z.ZodNumber>;
        version: z.ZodNumber;
        publishedAt: z.ZodString;
        publishedBy: z.ZodNullable<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        bytes: z.ZodNumber;
        staleAt: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type AgentReportListResponse = z.infer<typeof agentReportListResponseSchema>;
export declare const reportsListResponseSchema: z.ZodObject<{
    reports: z.ZodArray<z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        section: z.ZodEnum<{
            content: "content";
            system: "system";
            team: "team";
            traffic: "traffic";
        }>;
        teamLeads: z.ZodBoolean;
        validHours: z.ZodNullable<z.ZodNumber>;
        version: z.ZodNumber;
        publishedAt: z.ZodString;
        publishedBy: z.ZodNullable<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        bytes: z.ZodNumber;
        staleAt: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
    }, z.core.$strip>>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type ReportsListResponse = AgentReportListResponse;
export declare const reportGetResponseSchema: z.ZodObject<{
    report: z.ZodObject<{
        slug: z.ZodString;
        title: z.ZodString;
        section: z.ZodEnum<{
            content: "content";
            system: "system";
            team: "team";
            traffic: "traffic";
        }>;
        teamLeads: z.ZodBoolean;
        validHours: z.ZodNullable<z.ZodNumber>;
        version: z.ZodNumber;
        publishedAt: z.ZodString;
        publishedBy: z.ZodNullable<z.ZodObject<{
            agentKeyId: z.ZodNumber;
            name: z.ZodString;
        }, z.core.$strip>>;
        bytes: z.ZodNumber;
        staleAt: z.ZodNullable<z.ZodString>;
        stale: z.ZodBoolean;
        body: z.ZodString;
    }, z.core.$strip>;
    serverNow: z.ZodString;
}, z.core.$strip>;
export type ReportGetResponse = z.infer<typeof reportGetResponseSchema>;
