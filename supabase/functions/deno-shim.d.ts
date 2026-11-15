// Minimal Deno typings so `tsc` (Node toolchain) can check Edge Function entry points.
// The real types come from the Deno runtime; `deno check` is the authority in CI.
declare const Deno: {
  env: { get(name: string): string | undefined; toObject(): Record<string, string> };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
