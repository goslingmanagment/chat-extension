// What the background sends the hub on ChatSpace for the reads that R20 F6b
// keys by conversation (docs/project-unite/architecture.md §11.1, hub HF-10):
// the recap status, the shared recaps, the dossier save (the tab's and the
// background's own after a full Recap), the archive feed (a first page with
// the Ping window, an older page, the head), the fan's card and dossier.
// Recorded on `main` 180f6ec, before F6b, through the whole background
// (composition root, hub facade, vendored SDK) against the in-process fake
// hub: method, path with its query string, body text. The ids a run mints are
// names (`<opId>`, `<generationRef>`, `<cursor>`). On ChatSpace the
// conversation is the fan, so F6b leaves every byte as it was — with the hub's
// `conversation-recaps-v1` and without it. Synthetic ids only.

export const CHATSPACE_RECORDED_READS = {
  backgroundSave:
    '[{"method":"POST","url":"/api/v1/client/pages/model-one/fans/2002/profile/from-generation","body":"{\\"generationRef\\":\\"<generationRef>\\",\\"clientRequestId\\":\\"<opId>\\"}"}]',
  reads: {
    recapStatus:
      '[{"method":"GET","url":"/api/v1/ai/recap-status?pageLabel=model-one&conversationRef=2002&fanRef=2002&personaDefinitionId=pdef_0123456789abcdef","body":null}]',
    recapRead:
      '[{"method":"GET","url":"/api/v1/client/pages/model-one/conversations/2002/recaps?personaDefinitionId=pdef_0123456789abcdef","body":null}]',
    recapSave:
      '[{"method":"POST","url":"/api/v1/client/pages/model-one/fans/2002/profile/from-generation","body":"{\\"generationRef\\":\\"<generationRef>\\",\\"clientRequestId\\":\\"<opId>\\"}"}]',
    feedFirst:
      '[{"method":"GET","url":"/api/v1/client/pages/model-one/conversations/2002/feed?limit=2&summaryWindow=100","body":null}]',
    feedOlder:
      '[{"method":"GET","url":"/api/v1/client/pages/model-one/conversations/2002/feed?cursor=<cursor>&limit=2","body":null}]',
    feedHead:
      '[{"method":"GET","url":"/api/v1/client/pages/model-one/conversations/2002/feed?limit=1","body":null}]',
    card:
      '[{"method":"GET","url":"/api/v2/spenders/onlyfans/2002?scope=page&pageLabel=model-one&period=30d","body":null}]',
    dossier:
      '[{"method":"GET","url":"/api/v1/pages/model-one/conversations/2002/profile","body":null}]',
  },
} as const;
