// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A feature's icon on a landing page, by its name on the vocabulary's closed
 * list (`LANDING_FEATURE_ICONS`): drawn here with the house's icon set, in
 * this chunk only.
 */
import type { ReactNode } from 'react';
import type { LandingFeatureIcon } from '@adminium/add-on-contracts/landing';
import {
  Calendar,
  Check,
  Clock,
  Heart,
  Leaf,
  Lock,
  Mail,
  MapPin,
  Move,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  Truck,
  Users,
  VolumeX,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Readonly<Record<LandingFeatureIcon, LucideIcon>> = {
  check: Check,
  star: Star,
  heart: Heart,
  'shield-check': ShieldCheck,
  clock: Clock,
  calendar: Calendar,
  'map-pin': MapPin,
  phone: Phone,
  mail: Mail,
  truck: Truck,
  leaf: Leaf,
  sparkles: Sparkles,
  zap: Zap,
  wind: Wind,
  'volume-x': VolumeX,
  move: Move,
  users: Users,
  wrench: Wrench,
  'thumbs-up': ThumbsUp,
  lock: Lock,
};

export function featureIcon(name: LandingFeatureIcon): ReactNode {
  const Of = ICONS[name];
  return <Of size={19} strokeWidth={2} aria-hidden="true" />;
}
