import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({ get: mockGet }),
  },
}));

import { getRoomInfo } from "../src/douyin_api";

beforeEach(() => {
  mockGet.mockReset();
});

describe("getRoomInfo 接口降级", () => {
  it("uid 缺失时 mobile 降级为 web 并打印警告", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGet.mockResolvedValue({
      data: { status_code: 0, data: { room_status: 2, user: { sec_uid: "" } } },
      headers: { "set-cookie": ["ttwid=abc; Path=/"] },
    });

    const res = await getRoomInfo("123456", { api: "mobile" });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("已降级为 web 接口"));
    expect(res.api).toBe("web");
    expect(res.living).toBe(false);
    warnSpy.mockRestore();
  });

  it("uid 类型非字符串时 userHTML 同样降级并打印警告", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGet.mockResolvedValue({
      data: { status_code: 0, data: { room_status: 0, user: { sec_uid: "" } } },
      headers: { "set-cookie": ["ttwid=abc; Path=/"] },
    });

    // @ts-expect-error 模拟老数据 uid 为 number 的情况
    const res = await getRoomInfo("123456", { api: "userHTML", uid: 123 });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("已降级为 web 接口"));
    expect(res.api).toBe("web");
    warnSpy.mockRestore();
  });
});

describe("getRoomInfoByUserWeb 未开播", () => {
  it("未开播时不再抛 assert 异常，正常返回未开播状态", async () => {
    mockGet.mockResolvedValue({
      data: "<html>抖音号：xxx</html>",
      headers: {},
    });

    // 修复前：userHTML 未开播返回 room: null，会被 getRoomInfo 的 assert 抛
    // "No room data, id xxx"，状态检测直接报错
    const res = await getRoomInfo("123456", { api: "userHTML", uid: "sec_uid_xxx" });

    expect(res.living).toBe(false);
    expect(res.api).toBe("userHTML");
  });
});
