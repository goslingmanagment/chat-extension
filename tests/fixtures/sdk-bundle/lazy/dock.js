// Fixture: the dock chunk carrying the SDK's AI feature stream helper.
function Fb(e,t){let n=new AbortController;return{done:(async()=>await Pb({options:e,method:`POST`,path:`/api/v1/ai/features/${encodeURIComponent(t.feature)}`,headers:t.debugPromptEcho?{"x-kernel-ai-capabilities":`debug-input-v1`}:void 0,body:t.body,signal:n.signal}))(),close:()=>n.abort()}}export{Fb as streamAiFeature};
