import type { ForumConfig } from "@/lib/types";
import { registerPlugin } from "./registry";

const musicFilmPlugin: ForumConfig = {
  fid: -576177,
  name: "音乐影视",
  baseUrl: "https://bbs.nga.cn/thread.php?fid=-576177",
  categories: [
    { id: "all", name: "全部" },
    { id: "music", name: "音乐讨论" },
    { id: "movie", name: "影视讨论" },
    { id: "drama", name: "剧集综艺" },
  ],
  subForums: [],
};

registerPlugin(musicFilmPlugin);
