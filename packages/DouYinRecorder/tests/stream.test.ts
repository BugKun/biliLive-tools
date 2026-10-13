import { beforeEach, describe, expect, it, vi } from "vitest";

const { getRoomInfoMock } = vi.hoisted(() => ({
  getRoomInfoMock: vi.fn(),
}));

vi.mock("../src/douyin_api", () => ({
  getRoomInfo: getRoomInfoMock,
  selectRandomAPI: vi.fn(() => "web"),
}));

import { getFormatPriorities, getStream } from "../src/stream";

const getStreamOptions = {
  channelId: "123",
  quality: "origin" as const,
  streamPriorities: [],
  sourcePriorities: [],
  formatPriorities: ["flv", "hls"] as Array<"flv" | "hls">,
};

const mockRoomInfo = (stream: { flv?: string; hls?: string }) => {
  getRoomInfoMock.mockResolvedValue({
    living: true,
    roomId: "123",
    owner: "owner",
    title: "title",
    streams: [],
    sources: [
      {
        name: "自动",
        streamMap: {},
        streams: [{ quality: "origin", name: "原画", ...stream }],
      },
    ],
    avatar: "",
    cover: "",
    liveId: "live-1",
    uid: "uid-1",
    api: "web",
  });
};

beforeEach(() => {
  getRoomInfoMock.mockReset();
});

const livingRoomInfo = (api: string) => ({
  living: true,
  roomId: "123",
  owner: "owner",
  title: "title",
  streams: [],
  sources: [
    {
      name: "自动",
      streamMap: {},
      streams: [
        {
          quality: "origin",
          name: "原画",
          flv: "https://example.com/live.flv",
          hls: "https://example.com/live.m3u8",
        },
      ],
    },
  ],
  avatar: "",
  cover: "",
  liveId: "live-1",
  uid: "uid-1",
  api,
});

const radioStreamOptions = {
  ...getStreamOptions,
  isLiveRadio: true,
};

describe("getStream 电台直播分支", () => {
  it("配置 mobile 时 mobile 优先，成功即停止", async () => {
    const calls: string[] = [];
    getRoomInfoMock.mockImplementation(async (_id: string, opts: any) => {
      calls.push(opts.api);
      return livingRoomInfo("mobile");
    });

    const result = await getStream({ ...radioStreamOptions, api: "mobile" });

    expect(calls).toEqual(["mobile"]);
    expect(result.currentStream.url).toBe("https://example.com/live.flv");
  });

  it("配置 userHTML 时 userHTML 优先", async () => {
    const calls: string[] = [];
    getRoomInfoMock.mockImplementation(async (_id: string, opts: any) => {
      calls.push(opts.api);
      return livingRoomInfo("userHTML");
    });

    await getStream({ ...radioStreamOptions, api: "userHTML" });

    expect(calls).toEqual(["userHTML"]);
  });

  it("mobile 未返回流时兜底尝试 userHTML", async () => {
    const calls: string[] = [];
    getRoomInfoMock.mockImplementation(async (_id: string, opts: any) => {
      calls.push(opts.api);
      if (opts.api === "mobile") {
        return { ...livingRoomInfo("web"), sources: [] };
      }
      return livingRoomInfo("userHTML");
    });

    const result = await getStream({ ...radioStreamOptions, api: "mobile" });

    expect(calls).toEqual(["mobile", "userHTML"]);
    expect(result.currentStream.url).toBe("https://example.com/live.flv");
  });

  it("未显式配置或配置 web 时默认 userHTML 优先（mobile 风控最严）", async () => {
    const calls: string[] = [];
    getRoomInfoMock.mockImplementation(async (_id: string, opts: any) => {
      calls.push(opts.api);
      return livingRoomInfo("userHTML");
    });

    await getStream({ ...radioStreamOptions, api: "web" });

    expect(calls).toEqual(["userHTML"]);
  });

  it("userHTML 未返回流时兜底尝试 mobile", async () => {
    const calls: string[] = [];
    getRoomInfoMock.mockImplementation(async (_id: string, opts: any) => {
      calls.push(opts.api);
      if (opts.api === "userHTML") {
        return { ...livingRoomInfo("web"), sources: [] };
      }
      return livingRoomInfo("mobile");
    });

    const result = await getStream({ ...radioStreamOptions, api: "web" });

    expect(calls).toEqual(["userHTML", "mobile"]);
    expect(result.currentStream.url).toBe("https://example.com/live.flv");
  });

  it("全部失败时聚合所有接口的失败原因", async () => {
    getRoomInfoMock.mockImplementation(async (_id: string, opts: any) => {
      throw new Error(`${opts.api} 请求失败`);
    });

    await expect(getStream({ ...radioStreamOptions, api: "mobile" })).rejects.toThrow(
      /mobile 请求失败.*userHTML 请求失败/,
    );
  });

  it("无流时错误信息使用真实执行的接口名（uid 缺失降级为 web）", async () => {
    getRoomInfoMock.mockResolvedValue({ ...livingRoomInfo("web"), sources: [] });

    await expect(getStream({ ...radioStreamOptions, api: "mobile" })).rejects.toThrow(
      /\[DouYin-web\] 未返回可用的流/,
    );
  });

  it("非电台直播仍按配置的接口单次请求", async () => {
    const calls: string[] = [];
    getRoomInfoMock.mockImplementation(async (_id: string, opts: any) => {
      calls.push(opts.api);
      return livingRoomInfo("web");
    });

    await getStream({ ...getStreamOptions, api: "web" });

    expect(calls).toEqual(["web"]);
  });
});

describe("getFormatPriorities", () => {
  it("默认 FLV 优先时切换为 HLS 优先并保留回退", () => {
    expect(getFormatPriorities(["flv", "hls"], true)).toEqual(["hls", "flv"]);
  });

  it("HLS 优先时切换为 FLV 优先并保留回退", () => {
    expect(getFormatPriorities(["hls", "flv"], true)).toEqual(["flv", "hls"]);
  });

  it("没有切流提示时保持原优先级", () => {
    expect(getFormatPriorities(["flv", "hls"])).toEqual(["flv", "hls"]);
  });

  it.each(["flv", "hls"] as const)("单格式配置 %s 不会被覆盖", (format) => {
    expect(getFormatPriorities([format], true)).toEqual([format]);
  });

  it("切流提示会让包含两种格式的流选择 HLS", async () => {
    mockRoomInfo({
      flv: "https://example.com/live.flv",
      hls: "https://example.com/live.m3u8",
    });

    const result = await getStream({
      ...getStreamOptions,
      preferAlternativeStream: true,
    });

    expect(result.currentStream.url).toBe("https://example.com/live.m3u8");
  });

  it("备用格式不可用时回退原格式", async () => {
    mockRoomInfo({ flv: "https://example.com/live.flv" });

    const result = await getStream({
      ...getStreamOptions,
      preferAlternativeStream: true,
    });

    expect(result.currentStream.url).toBe("https://example.com/live.flv");
  });
});
