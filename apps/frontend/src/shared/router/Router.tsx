import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import Layout from "../components/Layout";
import CallSchedule from "../../features/call-schedule/pages/CallSchedule";

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Navigate to="/call-schedule" replace />,
      },
      {
        path: 'call-schedule',
        element: <CallSchedule />,
      },
      {
        path: '*',
        element: <Navigate to="/call-schedule" replace />,
      }
    ]
  }
]);

export default function Router() {
  return <RouterProvider router={router} />
}
