import type { ForumConfig } from "@/lib/types";
import { registerPlugin } from "./registry";

const carClubPlugin: ForumConfig = {
  fid: -343809,
  name: "汽车俱乐部",
  baseUrl: "https://bbs.nga.cn/thread.php?fid=-343809",
  categories: [
    { id: "all", name: "全部" },
    { id: "car-buy", name: "购车咨询", fid: -343809 },
    { id: "car-exp", name: "用车经验", fid: -343809 },
    { id: "car-mod", name: "改装美容", fid: -343809 },
    { id: "car-racing", name: "赛事讨论", fid: -343809 },
    { id: "car-news", name: "车市新闻", fid: -343809 },
    { id: "car-talk", name: "闲聊水区", fid: -343809 },
  ],
  subForums: [],
};

registerPlugin(carClubPlugin);
