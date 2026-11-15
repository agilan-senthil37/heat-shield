import type { Metadata } from 'next';
import './style.css';
import PlanningWorkspace from './planning-workspace';
export const metadata: Metadata = {title:'Heat Shield · Planting priorities', description:'Explore where more tree canopy could make a difference in San José.'};
export default function Layout({children}: {children: React.ReactNode}) {
  return <html lang="en"><body><PlanningWorkspace/>{children}</body></html>;
}
