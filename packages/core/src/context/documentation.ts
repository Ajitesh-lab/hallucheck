/** Future capability boundary; no external retrieval implementation is enabled in this MVP. */
export interface OfficialDocumentationRequest {
  packageName: string;
  version?: string;
  symbol: string;
  allowedOfficialOrigins: string[];
}
export interface OfficialDocumentationEvidence {
  url: string;
  retrievedAt: string;
  contentHash: string;
  excerpt: string;
  limitations: string[];
}
export interface OfficialDocumentationRetriever {
  retrieve(
    request: OfficialDocumentationRequest,
    signal: AbortSignal,
  ): Promise<OfficialDocumentationEvidence[]>;
}
