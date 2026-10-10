import { AppSidebar } from "../../components/app-sidebar";
import { FeedColumn } from "../../components/feed";
import { Rail } from "../../components/rail";

// The mock Gamorite feed from design/prototype.html, as real components for the loader to stamp.
export default function Page() {
  return (
    <div className="h-root">
      <div className="h-app">
        <AppSidebar />
        <FeedColumn />
        <Rail />
      </div>
    </div>
  );
}
