import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createRenderer, defineComponent, h, ref, type App } from "vue";
import { createI18n } from "vue-i18n";
import { useWikidataEntity, type WikidataEntity } from "./useWikidataEntity";

// This renderer exercises component setup without a DOM; host mutations are intentionally empty.
// oxlint-disable no-empty-function
const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
});
// oxlint-enable no-empty-function

const apps: App[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const app of apps.splice(0)) app.unmount();
  globalThis.fetch = originalFetch;
});

function mountLookup(id: string) {
  let entity = ref<WikidataEntity | null>(null);
  const app = renderer.createApp(
    defineComponent({
      setup() {
        entity = useWikidataEntity(ref({ wikidata: id })).entity;
        return () => h("div");
      },
    }),
  );
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} } }));
  app.mount({});
  apps.push(app);
  return entity;
}

function entityResponse(id: string) {
  return Response.json({
    entities: {
      [id]: { descriptions: { en: { value: "Example project" } }, claims: {} },
    },
  });
}

async function flushRequests() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useWikidataEntity", () => {
  test.each([
    {
      name: "HTTP failure",
      id: "Q900000001",
      failure: new Response(null, { status: 503 }),
    },
    {
      name: "network failure",
      id: "Q900000002",
      failure: new Error("Network unavailable"),
    },
    {
      name: "API error",
      id: "Q900000003",
      failure: Response.json({ error: { code: "maxlag" } }),
    },
  ])("retries after $name when another card mounts", async ({ id, failure }) => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(entityResponse(id));
    if (failure instanceof Error) fetchSpy.mockRejectedValueOnce(failure);
    else fetchSpy.mockResolvedValueOnce(failure);

    const first = mountLookup(id);
    await flushRequests();
    expect(first.value).toBeNull();

    const reopened = mountLookup(id);
    await flushRequests();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(reopened.value?.description).toBe("Example project");
  });

  test("reuses successful results across cards", async () => {
    const id = "Q900000004";
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(entityResponse(id));
    const first = mountLookup(id);
    await flushRequests();
    const reopened = mountLookup(id);
    await flushRequests();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(reopened.value).toEqual(first.value);
    expect(reopened.value?.description).toBe("Example project");
  });

  test("shares an in-flight request between card views", async () => {
    const id = "Q900000005";
    const { promise, resolve } = Promise.withResolvers<Response>();
    const fetchSpy = spyOn(globalThis, "fetch").mockReturnValue(promise);
    const header = mountLookup(id);
    const metadata = mountLookup(id);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolve(entityResponse(id));
    await flushRequests();
    expect(header.value?.description).toBe("Example project");
    expect(metadata.value).toEqual(header.value);
  });
});
