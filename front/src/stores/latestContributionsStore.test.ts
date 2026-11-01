import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import superjson from "superjson";
import { nextTick, watch } from "vue";
import type { RouterOutput } from "@/client";
import { selectedProjectTags } from "@/services/core/filters";
import { useUiStore } from "@/stores/uiStore";
import type { LatestContribution } from "@/types/index";
import { useLatestContributionsStore } from "@/stores/latestContributionsStore";

type FeedPage = RouterOutput["feed"]["getLatestContributions"];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  setActivePinia(createPinia());
  // Drive requests explicitly so debounce timers cannot start background requests.
  useUiStore().activeTab = "filter";
  selectedProjectTags.value = [];
});

afterEach(() => {
  useLatestContributionsStore().$dispose();
  selectedProjectTags.value = [];
  globalThis.fetch = originalFetch;
});

function project(id: string): LatestContribution {
  return {
    type: "standalone",
    id,
    name: id,
    filename: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    city: null,
    state: null,
    country: null,
    countryCode: "FRA",
    tags: [],
    shape: null,
    lat: 48,
    lng: 2,
    geometryBbox: null,
  };
}

function pageResponse(items: LatestContribution[], nextCursor: FeedPage["nextCursor"] = null) {
  return Response.json([{ result: { data: superjson.serialize({ items, nextCursor }) } }]);
}

function countResponse(count: number): Response {
  return Response.json({ result: { data: superjson.serialize({ count }) } });
}

function respondToPages(
  respond: () => Promise<Response>,
  respondToCount: () => Promise<Response> = async () => countResponse(42),
): void {
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: URL | RequestInfo) => {
        if (String(url).includes("feed.getContributionCount")) {
          return respondToCount();
        }
        return respond();
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
}

describe("latest contribution loading", () => {
  test("loads rows without waiting for the count and shares pending requests across activations", async () => {
    const feed = useLatestContributionsStore();
    const pendingCount = Promise.withResolvers<Response>();
    const countReady = Promise.withResolvers<undefined>();
    let pageRequests = 0;
    let countRequests = 0;
    respondToPages(
      async () => {
        pageRequests += 1;
        return pageResponse([project("first")]);
      },
      async () => {
        countRequests += 1;
        return pendingCount.promise;
      },
    );
    const stop = watch(
      () => feed.isCountStale,
      (stale) => {
        if (!stale) countReady.resolve(undefined);
      },
    );
    try {
      await Promise.all([feed.activateLatestContributions(), feed.activateLatestContributions()]);
      expect(feed.contributions.map((item) => item.id)).toEqual(["first"]);
      expect(feed.isFeedStale).toBeFalse();
      expect(feed.isCountStale).toBeTrue();

      await feed.activateLatestContributions();
      expect(pageRequests).toBe(1);
      expect(countRequests).toBe(1);

      pendingCount.resolve(countResponse(123));
      await countReady.promise;
      expect(feed.projectCount).toBe(123);
    } finally {
      stop();
    }
  });

  test("distinguishes a failed first page from a successful empty result and allows retry", async () => {
    const feed = useLatestContributionsStore();
    respondToPages(async () => {
      throw new Error("Network unavailable");
    });
    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await feed.activateLatestContributions();
    } finally {
      consoleSpy.mockRestore();
    }
    expect(feed.isLoading).toBeFalse();
    expect(feed.hasLoadError).toBeTrue();
    expect(feed.isFeedStale).toBeTrue();
    expect(feed.contributions).toEqual([]);

    respondToPages(async () => pageResponse([]));
    await feed.activateLatestContributions();
    expect(feed.hasLoadError).toBeFalse();
    expect(feed.isFeedStale).toBeFalse();
    expect(feed.contributions).toEqual([]);
  });

  test("retains previous results during a filter refresh and after failure, replacing them on retry", async () => {
    const feed = useLatestContributionsStore();
    const previous = project("previous");
    respondToPages(async () => pageResponse([previous]));
    await feed.activateLatestContributions();

    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    selectedProjectTags.value = ["rail"];
    const request = feed.activateLatestContributions();
    await started.promise;
    expect(feed.isLoading).toBeTrue();
    expect(feed.isFeedStale).toBeTrue();
    expect(feed.hasLoadError).toBeFalse();
    expect(feed.contributions).toEqual([previous]);

    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      pending.reject(new Error("Network unavailable"));
      await request;
    } finally {
      consoleSpy.mockRestore();
    }
    expect(feed.hasLoadError).toBeTrue();
    expect(feed.isLoading).toBeFalse();
    expect(feed.contributions).toEqual([previous]);

    const updated = project("updated");
    respondToPages(async () => pageResponse([updated]));
    await feed.activateLatestContributions();
    expect(feed.hasLoadError).toBeFalse();
    expect(feed.isFeedStale).toBeFalse();
    expect(feed.contributions).toEqual([updated]);
  });

  test("a late filtered response cannot replace cached results after the filter is removed", async () => {
    const feed = useLatestContributionsStore();
    const previous = project("previous");
    respondToPages(async () => pageResponse([previous]));
    await feed.activateLatestContributions();

    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    selectedProjectTags.value = ["rail"];
    const request = feed.activateLatestContributions();
    await started.promise;
    selectedProjectTags.value = [];
    await feed.activateLatestContributions();
    pending.resolve(pageResponse([project("filtered")]));
    await request;

    expect(feed.contributions).toEqual([previous]);
    expect(feed.isFeedStale).toBeFalse();
    expect(feed.isLoading).toBeFalse();
  });

  test("setting the map area loads while the feed is inactive and includes OSM", async () => {
    const feed = useLatestContributionsStore();
    respondToPages(async () => pageResponse([]));
    const finished = Promise.withResolvers<undefined>();
    const stop = watch(
      () => feed.isFeedStale,
      () => finished.resolve(undefined),
      { once: true },
    );
    try {
      feed.setMapArea({ west: 1, south: 47, east: 3, north: 49 });
      await finished.promise;
      expect(feed.isOsmIncluded).toBeTrue();
    } finally {
      stop();
    }
  });

  test("a late failure cannot mark a newer successful query as failed", async () => {
    const feed = useLatestContributionsStore();
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    const first = feed.activateLatestContributions();
    await started.promise;
    selectedProjectTags.value = ["rail"];
    const current = project("current");
    respondToPages(async () => pageResponse([current]));
    await feed.activateLatestContributions();

    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      pending.reject(new Error("Old request failed"));
      await first;
    } finally {
      consoleSpy.mockRestore();
    }
    expect(feed.hasLoadError).toBeFalse();
    expect(feed.isFeedStale).toBeFalse();
    expect(feed.contributions).toEqual([current]);
  });

  test("invalidation clears loading and prevents an in-flight response from repopulating the feed", async () => {
    const feed = useLatestContributionsStore();
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    const request = feed.activateLatestContributions();
    await started.promise;
    feed.invalidateLatestContributions();
    expect(feed.isLoading).toBeFalse();
    pending.resolve(pageResponse([project("obsolete")]));
    await request;
    expect(feed.contributions).toEqual([]);
    expect(feed.isFeedStale).toBeTrue();
    expect(feed.hasLoadError).toBeFalse();
  });

  test("pagination failure keeps loaded rows and retries the same page", async () => {
    const feed = useLatestContributionsStore();
    const first = project("first");
    const cursor = { direct: { date: first.updatedAt.toISOString(), id: first.id } };
    respondToPages(async () => pageResponse([first], cursor));
    await feed.activateLatestContributions();
    respondToPages(async () => {
      throw new Error("Next page failed");
    });
    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await feed.loadMoreLatestContributions();
    } finally {
      consoleSpy.mockRestore();
    }
    expect(feed.hasLoadMoreError).toBeTrue();
    expect(feed.hasLoadError).toBeFalse();
    expect(feed.isLoadingMore).toBeFalse();
    expect(feed.contributions).toEqual([first]);
    expect(feed.hasMore).toBeTrue();

    const second = project("second");
    respondToPages(async () => pageResponse([second]));
    await feed.loadMoreLatestContributions();
    expect(feed.hasLoadMoreError).toBeFalse();
    expect(feed.contributions).toEqual([first, second]);
    expect(feed.hasMore).toBeFalse();
  });
});

test("disposing the feed cancels its scheduled filter refresh", async () => {
  const feed = useLatestContributionsStore();
  const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
  useUiStore().activeTab = "explore";
  selectedProjectTags.value = ["rail"];
  // Let the watcher schedule its debounce before disposing its owning store.
  await nextTick();
  feed.$dispose();
  await Bun.sleep(350);
  expect(fetchSpy).not.toHaveBeenCalled();
});
