import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import superjson from "superjson";
import { watch } from "vue";
import type { RouterOutput } from "@/client";
import { selectedProjectTags } from "@/services/core/filters";
import { useUiStore } from "@/stores/uiStore";
import type { LatestContribution } from "@/types/index";
import {
  activateLatestContributions,
  contributions,
  hasLoadError,
  hasLoadMoreError,
  hasMore,
  invalidateLatestContributions,
  isCountStale,
  isFeedStale,
  isLoading,
  isLoadingMore,
  isOsmIncluded,
  loadMoreLatestContributions,
  mapArea,
  projectCount,
  setMapArea,
} from "./latestContributions";

type FeedPage = RouterOutput["feed"]["getLatestContributions"];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  setActivePinia(createPinia());
  // Drive requests explicitly so debounce timers cannot start background requests.
  useUiStore().activeTab = "filter";
  invalidateLatestContributions();
  selectedProjectTags.value = [];
  isOsmIncluded.value = false;
  mapArea.value = null;
});

afterEach(() => {
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
    const stop = watch(isCountStale, (stale) => {
      if (!stale) countReady.resolve(undefined);
    });
    try {
      await Promise.all([activateLatestContributions(), activateLatestContributions()]);
      expect(contributions.value.map((item) => item.id)).toEqual(["first"]);
      expect(isFeedStale.value).toBeFalse();
      expect(isCountStale.value).toBeTrue();

      await activateLatestContributions();
      expect(pageRequests).toBe(1);
      expect(countRequests).toBe(1);

      pendingCount.resolve(countResponse(123));
      await countReady.promise;
      expect(projectCount.value).toBe(123);
    } finally {
      stop();
    }
  });

  test("distinguishes a failed first page from a successful empty result and allows retry", async () => {
    respondToPages(async () => {
      throw new Error("Network unavailable");
    });
    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await activateLatestContributions();
    } finally {
      consoleSpy.mockRestore();
    }
    expect(isLoading.value).toBeFalse();
    expect(hasLoadError.value).toBeTrue();
    expect(isFeedStale.value).toBeTrue();
    expect(contributions.value).toEqual([]);

    respondToPages(async () => pageResponse([]));
    await activateLatestContributions();
    expect(hasLoadError.value).toBeFalse();
    expect(isFeedStale.value).toBeFalse();
    expect(contributions.value).toEqual([]);
  });

  test("retains previous results during a filter refresh and after failure, replacing them on retry", async () => {
    const previous = project("previous");
    respondToPages(async () => pageResponse([previous]));
    await activateLatestContributions();

    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    selectedProjectTags.value = ["rail"];
    const request = activateLatestContributions();
    await started.promise;
    expect(isLoading.value).toBeTrue();
    expect(isFeedStale.value).toBeTrue();
    expect(hasLoadError.value).toBeFalse();
    expect(contributions.value).toEqual([previous]);

    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      pending.reject(new Error("Network unavailable"));
      await request;
    } finally {
      consoleSpy.mockRestore();
    }
    expect(hasLoadError.value).toBeTrue();
    expect(isLoading.value).toBeFalse();
    expect(contributions.value).toEqual([previous]);

    const updated = project("updated");
    respondToPages(async () => pageResponse([updated]));
    await activateLatestContributions();
    expect(hasLoadError.value).toBeFalse();
    expect(isFeedStale.value).toBeFalse();
    expect(contributions.value).toEqual([updated]);
  });

  test("a late filtered response cannot replace cached results after the filter is removed", async () => {
    const previous = project("previous");
    respondToPages(async () => pageResponse([previous]));
    await activateLatestContributions();

    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    selectedProjectTags.value = ["rail"];
    const request = activateLatestContributions();
    await started.promise;
    selectedProjectTags.value = [];
    await activateLatestContributions();
    pending.resolve(pageResponse([project("filtered")]));
    await request;

    expect(contributions.value).toEqual([previous]);
    expect(isFeedStale.value).toBeFalse();
    expect(isLoading.value).toBeFalse();
  });

  test("changing the map area also retains previous results until the replacement arrives", async () => {
    const previous = project("previous");
    respondToPages(async () => pageResponse([previous]));
    await activateLatestContributions();

    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    setMapArea({ west: 1, south: 47, east: 3, north: 49 });
    await started.promise;
    expect(isOsmIncluded.value).toBeTrue();
    expect(isFeedStale.value).toBeTrue();
    expect(contributions.value).toEqual([previous]);

    const updated = project("in-area");
    const finished = Promise.withResolvers<undefined>();
    // This test owns the watcher and stops it in finally; no component lifecycle is involved.
    // oxlint-disable-next-line harlanzw/vue-no-reactivity-after-await
    const stop = watch(isLoading, () => finished.resolve(undefined), { once: true });
    try {
      pending.resolve(pageResponse([updated]));
      await finished.promise;
    } finally {
      stop();
    }
    expect(isFeedStale.value).toBeFalse();
    expect(contributions.value).toEqual([updated]);
  });

  test("a late failure cannot mark a newer successful query as failed", async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    const first = activateLatestContributions();
    await started.promise;
    selectedProjectTags.value = ["rail"];
    const current = project("current");
    respondToPages(async () => pageResponse([current]));
    await activateLatestContributions();

    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      pending.reject(new Error("Old request failed"));
      await first;
    } finally {
      consoleSpy.mockRestore();
    }
    expect(hasLoadError.value).toBeFalse();
    expect(isFeedStale.value).toBeFalse();
    expect(contributions.value).toEqual([current]);
  });

  test("invalidation clears loading and prevents an in-flight response from repopulating the feed", async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<undefined>();
    respondToPages(async () => {
      started.resolve(undefined);
      return pending.promise;
    });
    const request = activateLatestContributions();
    await started.promise;
    invalidateLatestContributions();
    expect(isLoading.value).toBeFalse();
    pending.resolve(pageResponse([project("obsolete")]));
    await request;
    expect(contributions.value).toEqual([]);
    expect(isFeedStale.value).toBeTrue();
    expect(hasLoadError.value).toBeFalse();
  });

  test("pagination failure keeps loaded rows and retries the same page", async () => {
    const first = project("first");
    const cursor = { direct: { date: first.updatedAt.toISOString(), id: first.id } };
    respondToPages(async () => pageResponse([first], cursor));
    await activateLatestContributions();
    respondToPages(async () => {
      throw new Error("Next page failed");
    });
    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await loadMoreLatestContributions();
    } finally {
      consoleSpy.mockRestore();
    }
    expect(hasLoadMoreError.value).toBeTrue();
    expect(hasLoadError.value).toBeFalse();
    expect(isLoadingMore.value).toBeFalse();
    expect(contributions.value).toEqual([first]);
    expect(hasMore.value).toBeTrue();

    const second = project("second");
    respondToPages(async () => pageResponse([second]));
    await loadMoreLatestContributions();
    expect(hasLoadMoreError.value).toBeFalse();
    expect(contributions.value).toEqual([first, second]);
    expect(hasMore.value).toBeFalse();
  });
});
