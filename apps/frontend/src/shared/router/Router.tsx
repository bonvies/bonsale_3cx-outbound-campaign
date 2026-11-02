import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import Layout from "../components/Layout";
import OutboundCampaign from "../../features/outbound-campaign/pages/OutboundCampaign";

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Navigate to="/outbound-campaign" replace />,
      },
      {
        path: 'outbound-campaign',
        element: <OutboundCampaign />,
      },
      {
        path: '*',
        element: <Navigate to="/outbound-campaign" replace />,
      }
    ]
  }
]);

export default function Router() {
  return <RouterProvider router={router} />
}
