import { createBrowserRouter, RouterProvider } from "react-router-dom";

import Layout from "../components/Layout";
import Home from "../../features/outbound-campaign/pages/Home";
import CallSchedule from "../../features/call-schedule/pages/CallSchedule";

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Home />,
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
