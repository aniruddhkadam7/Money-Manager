import { describe, expect, it } from "vitest";
import { speakable } from "@/lib/voice/llm-proxy";

describe("what the live assistant says aloud", () => {
  it("has no formatting marks to be read out", () => {
    expect(speakable("**Yes**, you have **₹1,20,728** — enough.")).toBe("Yes, you have ₹1,20,728, enough.");
    expect(speakable("## Verdict\n| Date | Amount |")).toBe(" Verdict\n Date  Amount ");
  });

  it("cleans a streamed answer, even a mark split between pieces, and leaves the rest alone", async () => {
    const { handleVoiceLlm } = await import("@/lib/voice/llm-proxy");
    const { issuePass } = await import("@/lib/voice/llm-pass");
    const env = { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-6-luna" };
    const sse = ['data: {"id":"1","choices":[{"delta":{"content":"You have *"}}]}', 'data: {"id":"2","choices":[{"delta":{"content":"*plenty**."}}]}', "data: [DONE]", ""].join("\n");
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(sse, { headers: { "content-type": "text/event-stream" } });
    try {
      const res = await handleVoiceLlm(new Request("http://x", { method: "POST", headers: { authorization: `Bearer ${issuePass(env)}` }, body: JSON.stringify({ stream: true, messages: [] }) }), env);
      const out = await res.text();
      const said = out.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)).choices[0].delta.content).join("");
      expect(said).toBe("You have plenty.");
      expect(out).toContain('"id":"2"');
      expect(out).toContain("data: [DONE]");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
