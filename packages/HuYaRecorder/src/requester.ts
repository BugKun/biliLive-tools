import axios from "axios";

export const requester = axios.create({
  timeout: 10e3,
  // 通过 HTTP_PROXY / HTTPS_PROXY 环境变量走代理
});
