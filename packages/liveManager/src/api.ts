import axios from "axios";
import { assert } from "./utils.js";

const requester = axios.create({
  timeout: 10e3,
  // 通过 HTTP_PROXY / HTTPS_PROXY 环境变量走代理
});

interface BilibiliResp<T = unknown> {
  code: number;
  message: string;
  msg?: string;
  data: T;
}

type LiveStatus =
  // 未开播
  | 0
  // 直播中
  | 1
  // 轮播中
  | 2;

export async function getBiliStatusInfoByRoomIds<RoomId extends number>(RoomIds: RoomId[]) {
  const roomParams = `${RoomIds.map((id) => `room_ids=${id}`).join("&")}`;
  const res = await requester.get<
    BilibiliResp<{
      by_uids: {};
      by_room_ids: Record<
        RoomId,
        {
          title: string;
          uname: string;
          live_time: string;
          live_status: LiveStatus;
          cover: string;
          is_encrypted: boolean;
        }
      >;
    }>
  >(
    `https://api.live.bilibili.com/xlive/web-room/v1/index/getRoomBaseInfo?${roomParams}&req_biz=web_room_componet`,
  );

  assert(res.data.code === 0, `Unexpected resp, code ${res.data.code}, msg ${res.data.message}`);

  const obj: Record<string, boolean> = {};
  for (const roomId of RoomIds) {
    try {
      const data = res.data.data.by_room_ids[roomId];
      obj[roomId] = data?.live_status === 1;
    } catch (e) {
      continue;
    }
  }
  return obj;
}
