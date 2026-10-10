import { globToRegExp } from "../core/glob";
import type { ProompterPlugin } from "../core/entry";

export type RepoPluginOptions = {
  /** Route glob (e.g. `/clips/**`) -> repo path of its task file. First match wins, in insertion order. */
  tasks?: Record<string, string>;
  /** Section names for the Test plan menu. */
  testPlan?: string[];
  /** Extra frontmatter fields. A throw is swallowed and yields `{}`. */
  context?: () => Record<string, unknown>;
  /** Plugin name. Default "repo". */
  name?: string;
};

/** A generic plugin for apps that keep task files and a test plan in their repo. */
export function repoPlugin(options: RepoPluginOptions = {}): ProompterPlugin {
  const { tasks, testPlan, context, name = "repo" } = options;
  // Globs are matched without the leading slash, like the loader's repo-relative paths.
  const rules = Object.entries(tasks ?? {}).map(([glob, file]) => ({ re: globToRegExp(glob.replace(/^\/+/, "")), file }));
  const plugin: ProompterPlugin = { name };
  if (rules.length) {
    plugin.taskFor = ({ route }) => {
      const pathname = route.split(/[?#]/)[0]!.replace(/^\/+/, "");
      return rules.find((r) => r.re.test(pathname))?.file ?? null;
    };
  }
  if (testPlan) plugin.testPlan = testPlan;
  if (context) {
    plugin.context = () => {
      try {
        return context();
      } catch {
        return {};
      }
    };
  }
  return plugin;
}
