import type { ForumConfig } from "@/lib/types";
import { registerPlugin } from "./registry";

export function createForumPlugin(fid: number, name: string, categories: ForumConfig["categories"] = []): ForumConfig {
  const config: ForumConfig = {
    fid,
    name,
    baseUrl: `https://bbs.nga.cn/thread.php?fid=${fid}`,
    categories,
    subForums: [],
  };
  registerPlugin(config);
  return config;
}
