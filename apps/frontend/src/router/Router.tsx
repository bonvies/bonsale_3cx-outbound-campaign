import { createBrowserRouter, RouterProvider } from "react-router-dom";

import Layout from "../components/Layout";
import Home from "../pages/Home";
import CallSchedule from "../pages/CallSchedule";

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
