import { createBrowserRouter, RouterProvider } from "react-router-dom";

import Layout from "../components/Layout";
import OutboundCampaign from "../../features/outbound-campaign/pages/OutboundCampaign";
import CallSchedule from "../../features/call-schedule/pages/CallSchedule";

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        path: 'outbound-campaign',
        element: <OutboundCampaign />,
      },
      {
        path: 'call-schedule',
        element: <CallSchedule />,
      }
    ]
  }
]);

export default function Router() {
  return <RouterProvider router={router} />
}
