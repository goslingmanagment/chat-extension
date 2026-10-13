// The conversation of a fan's chat where the contracts carry it as an
// optional member (1.15.0: `RouteState`, `NavigationIntent.target`,
// `BackgroundToast`): present only when it is not the fan — on Fansly the
// group id of `/messages/<groupId>`. On OnlyFans the conversation is the fan
// (`Target` pins it), the member is absent, and what ChatSpace sends, keys and
// opens stays byte for byte as it was before (docs/project-unite/
// architecture.md §1.9, R20 F6a).

/** `{conversationRef}` when the conversation is not the fan; `{}` when it is, or when nobody named one. */
export function conversationOf(fanRef: string | null, conversationRef: string | undefined): { readonly conversationRef?: string } {
  return conversationRef === undefined || conversationRef === fanRef ? {} : { conversationRef };
}
