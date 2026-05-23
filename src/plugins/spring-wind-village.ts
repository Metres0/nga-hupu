import type { ForumConfig } from "@/lib/types";
import { registerPlugin } from "./registry";

const springWindPlugin: ForumConfig = {
  fid: -7955747,
  name: "晴风村",
  baseUrl: "https://bbs.nga.cn/thread.php?fid=-7955747",
  categories: [
    { id: "all", name: "全部" },
    { id: "love", name: "情感交流", fid: -7955747 },
    { id: "marriage", name: "谈婚论嫁", fid: -7955747 },
    { id: "daily", name: "日常水区", fid: -7955747 },
  ],
  subForums: [],
  requiresLogin: true,
};

registerPlugin(springWindPlugin);
