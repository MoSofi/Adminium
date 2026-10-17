// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A place and an area in a record: the two controls a column gets when its
 * rule says it holds a position on the map (`place`) or a shape (`area`).
 * Chosen by the column's own mark, as the mentions box is, whichever control
 * the page stored for the column.
 *
 * A PLACE is typed as a town (the server's own list answers, in the reader's
 * language), pasted as coordinates or a map link (sent as the text it is: the
 * server reads it, and refuses by the column what it cannot read), taken from
 * the device ("Where I am"), or — while maps are on — put by dragging the pin
 * on a small map. The field always says which kind it holds: a town's middle
 * ("By town") is not a door, and nobody should take it for one.
 *
 * An AREA is drawn on the small map. While maps are off there is no way to
 * draw: the field says so, and says how many points the stored shape has —
 * never a box of raw JSON for staff to edit.
 */
import { Button, Input } from '@adminium/ui';
import { LocateFixed, MapPin, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { MapBubble } from '../../../families/geo/MapBubble.js';
import type { GeoPoint } from '../../../families/geo/geo-lib.js';
import { isAreaGeometry, pointCount, type AreaGeometry } from '../../../families/geo/map-shapes.js';
import { areaValueOf, coordinateText, latinDigits, looksLikePosition, placeValueOf, type PlaceSuggestion } from '../../../families/geo/place-value.js';
import { StatusNote } from '../../../families/geo/StatusNote.js';
import { useWidgetRuntimeEnv } from '../../../frame/WidgetRuntimeContext.js';
import { useMaybeT } from '../../../lib/i18n.js';
import { mapServerOf } from '../../../registry/map-server.js';
import type { ControlProps } from './types.js';

/** A pause in the typing before the list is asked: the search budget is 60 a minute. */
export const PLACE_SEARCH_DELAY_MS = 350;
const PLACE_SEARCH_MIN = 2;

export function PlaceControl(props: ControlProps) {
  const { value, onChange, places, disabled, error, id } = props;
  const t = useMaybeT();
  const listId = useId();
  const mapsOn = mapServerOf(useWidgetRuntimeEnv()) !== null;
  const held = placeValueOf(value);
  // Text on its way to the server (coordinates, a map link): read when the record is saved.
  const pending = typeof value === 'string' && value.trim() !== '' && held === null ? value : null;

  const [text, setText] = useState('');
  const [found, setFound] = useState<readonly PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  // The list was asked and did not answer (too many questions, no network): not "no such town".
  const [failed, setFailed] = useState(false);
  const [whereError, setWhereError] = useState(false);
  const asked = useRef(0);
  // The search is read as it is NOW, not kept as a dependency: a page that
  // hands a new function on every draw must not make the field ask again.
  const placesRef = useRef(places);
  placesRef.current = places;

  // The list is asked after a pause, once for a text, and only for something
  // that reads as a name. Every change of the text makes what was asked
  // before out of date: its answer is dropped when it comes, and the list on
  // screen (the answer to another question) goes at once, so nothing is
  // offered, or taken with Enter, under a text it was not found for.
  useEffect(() => {
    const query = text.trim();
    const turn = (asked.current += 1);
    setFound([]);
    setActive(-1);
    setFailed(false);
    const search = placesRef.current;
    if (search === undefined || query.length < PLACE_SEARCH_MIN || looksLikePosition(query)) {
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      search(query).then(
        (list) => {
          if (asked.current !== turn) return;
          setFound(list);
          setActive(list.length > 0 ? 0 : -1);
          setSearching(false);
        },
        () => {
          if (asked.current !== turn) return;
          setFailed(true);
          setSearching(false);
        },
      );
    }, PLACE_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const pick = (place: PlaceSuggestion): void => {
    onChange({ placeId: place.id, lat: place.lat, lng: place.lng, by: 'town', name: place.name, ...(place.country === undefined ? {} : { country: place.country }) });
    setText('');
    setFound([]);
    setOpen(false);
  };

  const typed = (next: string): void => {
    setText(next);
    setOpen(true);
    setWhereError(false);
    // Coordinates or a link are the value as they stand, in Latin digits whatever keyboard typed them;
    // a name is nothing until a town is chosen.
    const position = latinDigits(next).trim();
    if (looksLikePosition(position)) onChange(position);
  };

  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator && (typeof window === 'undefined' || window.isSecureContext !== false);
  const locate = (): void => {
    setWhereError(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({ lat: position.coords.latitude, lng: position.coords.longitude, by: 'exact' });
        setText('');
      },
      () => setWhereError(true),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const point = useMemo<GeoPoint[]>(
    () =>
      held === null
        ? []
        : [{ name: held.name ?? t('ui:widgets.geo.place.pinName', 'This place'), lat: held.lat, lng: held.lng, by: held.by, values: {} }],
    [held?.lat, held?.lng, held?.by, held?.name, t],
  );

  const showList = open && text.trim().length >= PLACE_SEARCH_MIN && !looksLikePosition(text.trim()) && places !== undefined;
  const describedBy = [props['aria-describedby'], `${listId}-kind`].filter((part) => part !== undefined).join(' ');

  return (
    <div data-part="place-field" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Input
            {...(id === undefined ? {} : { id })}
            type="text"
            role="combobox"
            aria-expanded={showList}
            // The list is in the page only while it is open: a name that points at nothing is not given.
            {...(showList ? { 'aria-controls': `${listId}-list` } : {})}
            aria-autocomplete="list"
            {...(active >= 0 && showList ? { 'aria-activedescendant': `${listId}-option-${active}` } : {})}
            {...(props['aria-label'] === undefined ? {} : { 'aria-label': props['aria-label'] })}
            aria-describedby={describedBy}
            {...(props['aria-invalid'] === undefined ? {} : { 'aria-invalid': props['aria-invalid'] })}
            {...(props['aria-required'] === undefined ? {} : { 'aria-required': props['aria-required'] })}
            {...(error === true ? { error: true as const } : {})}
            {...(disabled === true ? { disabled: true as const } : {})}
            autoComplete="off"
            placeholder={props.field?.placeholder ?? t('ui:widgets.geo.place.placeholder', 'Type a town, or paste coordinates or a map link')}
            value={text}
            onChange={(event) => typed(event.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (!showList || found.length === 0) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
              } else if (event.key === 'Enter' && active >= 0) {
                event.preventDefault();
                pick(found[active]!);
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          />
          {showList && (
            <ul
              id={`${listId}-list`}
              role="listbox"
              data-part="place-suggestions"
              className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
            >
              {found.map((place, index) => (
                <li
                  key={place.id}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-part="place-suggestion"
                  // Before the box loses the focus, so the pick is not lost with it.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(place);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex cursor-pointer flex-col px-3 py-1.5 text-body-sm ${index === active ? 'bg-surface-2' : ''}`}
                >
                  <span className="truncate text-fg">{place.name}</span>
                  <span className="truncate text-caption text-fg-subtle">{[place.region, place.countryName].filter((part) => part !== null && part !== undefined && part !== '').join(', ')}</span>
                </li>
              ))}
              {found.length === 0 && (
                <li role="presentation" className="px-3 py-1.5 text-caption text-fg-subtle">
                  {searching
                    ? t('ui:widgets.geo.place.searching', 'Looking…')
                    : failed
                      ? t('ui:widgets.geo.place.searchFailed', 'The town list could not be asked just now. Try again, or paste coordinates.')
                      : t('ui:widgets.geo.place.noTown', 'No town by that name. Try another spelling, or paste coordinates.')}
                </li>
              )}
            </ul>
          )}
        </div>
        {canLocate && (
          <Button type="button" variant="secondary" size="md" data-part="place-where-i-am" disabled={disabled === true} onClick={locate}>
            <LocateFixed aria-hidden="true" />
            {t('ui:widgets.geo.place.whereIAm', 'Where I am')}
          </Button>
        )}
      </div>

      <p id={`${listId}-kind`} data-part="place-kind" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
        <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle" />
        {held !== null ? (
          <>
            <span className="min-w-0 truncate">
              {held.by === 'town'
                ? t('ui:widgets.geo.place.byTown', 'By town: {name}', { name: held.name ?? coordinateText(held) })
                : held.name === undefined
                  ? t('ui:widgets.geo.place.exact', 'Exact spot: {position}', { position: coordinateText(held) })
                  : t('ui:widgets.geo.place.exactNamed', 'Exact spot: {name} ({position})', { name: held.name, position: coordinateText(held) })}
            </span>
          </>
        ) : pending !== null ? (
          <span className="min-w-0 truncate">{t('ui:widgets.geo.place.pending', 'Read when you save: {text}', { text: pending })}</span>
        ) : (
          <span>{t('ui:widgets.geo.place.none', 'No place yet')}</span>
        )}
        {(held !== null || pending !== null) && disabled !== true && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-part="place-clear"
            onClick={() => {
              onChange(null);
              setText('');
            }}
          >
            <X aria-hidden="true" />
            {t('ui:widgets.geo.place.clear', 'Clear')}
          </Button>
        )}
      </p>
      {whereError && (
        <p role="alert" className="text-caption text-danger">
          {t('ui:widgets.geo.place.whereError', 'This device did not say where it is. Check that the browser may use your location.')}
        </p>
      )}

      {mapsOn && held !== null && (
        <div data-part="place-map" className="h-64 min-w-0 [--widget-pad:0px]">
          <MapBubble
            points={point}
            topN={0}
            showValues={false}
            flyToOnClick={false}
            {...(disabled === true ? {} : { onPlace: (_point: GeoPoint, at: { lat: number; lng: number }) => onChange({ lat: at.lat, lng: at.lng, by: 'exact', ...(held.name === undefined || held.by === 'town' ? {} : { name: held.name }) }) })}
          />
        </div>
      )}
    </div>
  );
}

export function AreaControl(props: ControlProps) {
  const { value, onChange, disabled } = props;
  const t = useMaybeT();
  const mapsOn = mapServerOf(useWidgetRuntimeEnv()) !== null;
  const geometry: AreaGeometry | null = areaValueOf(value);
  const areas = useMemo(() => (geometry === null ? [] : [{ id: 'area', geometry }]), [geometry]);
  const count = geometry === null ? 0 : pointCount(geometry);
  // A value that is there and is no shape (a hand-written row): said, not hidden.
  const unreadable = value !== null && value !== undefined && value !== '' && !isAreaGeometry(geometry);

  return (
    <div data-part="area-field" className="flex min-w-0 flex-col gap-2">
      <p data-part="area-kind" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
        <span>
          {geometry !== null
            ? t('ui:widgets.geo.area.points', 'Area · {count, plural, one {# point} other {# points}}', { count })
            : unreadable
              ? t('ui:widgets.geo.area.unreadable', 'The stored value is not an area. Draw one to replace it.')
              : t('ui:widgets.geo.area.none', 'No area yet')}
        </span>
        {(geometry !== null || unreadable) && disabled !== true && (
          <Button type="button" variant="ghost" size="sm" data-part="area-clear" onClick={() => onChange(null)}>
            <X aria-hidden="true" />
            {t('ui:widgets.geo.area.clear', 'Clear')}
          </Button>
        )}
      </p>
      {mapsOn ? (
        <div data-part="area-map" className="min-h-80 min-w-0 [--widget-pad:0px]">
          <MapBubble
            points={[]}
            areas={areas}
            topN={0}
            {...(disabled === true ? {} : { onAreaChange: (_id: string | null, next: AreaGeometry) => onChange(next) })}
          />
        </div>
      ) : (
        <StatusNote data-part="area-maps-off" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-body-sm text-fg-muted">
          {t('ui:widgets.geo.area.mapsOff', 'An area is drawn on the map, and maps are switched off. The area that is stored is kept as it is.')}
        </StatusNote>
      )}
    </div>
  );
}
