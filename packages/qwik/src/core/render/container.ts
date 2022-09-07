import { assertEqual } from '../assert/assert';
import { getProxyTarget } from '../object/q-object';
import { getPlatform } from '../platform/platform';
import type { CorePlatform } from '../platform/types';
import type { Subscriber, SubscriberEffect } from '../use/use-watch';
import { isQwikElement } from '../util/element';
import { seal } from '../util/qdev';
import { notifyChange } from './dom/notify-render';
import { isSignalOperation, SignalOperation } from './dom/signals';
import type { QwikElement } from './dom/virtual-element';
import type { RenderStaticContext } from './types';

export type ObjToProxyMap = WeakMap<any, any>;
export type SubscriberMap = Map<Subscriber, Set<string> | null>;
export type ObjToSubscriberMap = WeakMap<any, LocalSubscriptionManager>;
export type SubscriberToSubscriberMap = Map<Subscriber, Set<SubscriberMap>>;
export type HostToSubscriberMap = Map<QwikElement, Set<SubscriberMap>>;

export interface SubscriptionManager {
  $tryGetLocal$(obj: any): LocalSubscriptionManager | undefined;
  $getLocal$(obj: any, map?: SubscriberMap): LocalSubscriptionManager;
  $clearSub$: (sub: Subscriber) => void;
}

export interface LocalSubscriptionManager {
  readonly $subs$: SubscriberMap;
  $notifySubs$: (key?: string | undefined) => void;
  $addSub$: (subscriber: Subscriber, key?: string) => void;
}

/**
 * @alpha
 */
export interface ContainerState {
  $containerEl$: Element;

  $proxyMap$: ObjToProxyMap;
  $subsManager$: SubscriptionManager;
  $platform$: CorePlatform;

  $watchNext$: Set<SubscriberEffect>;
  $watchStaging$: Set<SubscriberEffect>;

  $opsNext$: Set<SignalOperation>;

  $hostsNext$: Set<QwikElement>;
  $hostsStaging$: Set<QwikElement>;
  $hostsRendering$: Set<QwikElement> | undefined;
  $renderPromise$: Promise<RenderStaticContext> | undefined;

  $envData$: Record<string, any>;
  $elementIndex$: number;

  $styleIds$: Set<string>;
  $mutableProps$: boolean;
}

const CONTAINER_STATE = Symbol('ContainerState');

export const getContainerState = (containerEl: Element): ContainerState => {
  let set = (containerEl as any)[CONTAINER_STATE] as ContainerState;
  if (!set) {
    (containerEl as any)[CONTAINER_STATE] = set = {
      $containerEl$: containerEl,

      $proxyMap$: new WeakMap(),
      $subsManager$: null as any,
      $platform$: getPlatform(containerEl),

      $watchNext$: new Set(),
      $watchStaging$: new Set(),

      $opsNext$: new Set(),

      $hostsNext$: new Set(),
      $hostsStaging$: new Set(),
      $renderPromise$: undefined,
      $hostsRendering$: undefined,

      $envData$: {},
      $elementIndex$: 0,

      $styleIds$: new Set(),
      $mutableProps$: false,
    };
    seal(set);
    set.$subsManager$ = createSubscriptionManager(set);
  }
  return set;
};

export const createSubscriptionManager = (containerState: ContainerState): SubscriptionManager => {
  const objToSubs: ObjToSubscriberMap = new Map();
  const subsToObjs: SubscriberToSubscriberMap = new Map();
  const hostToSub: HostToSubscriberMap = new Map();

  const clearSub = (sub: Subscriber) => {
    const subs = subsToObjs.get(sub);
    if (subs) {
      subs.forEach((s) => {
        s.delete(sub);
      });
      subsToObjs.delete(sub);
      subs.clear();
    }
  };

  const tryGetLocal = (obj: any) => {
    assertEqual(getProxyTarget(obj), undefined, 'object can not be be a proxy', obj);
    return objToSubs.get(obj);
  };

  const trackSubToObj = (subscriber: Subscriber, map: SubscriberMap) => {
    let set = subsToObjs.get(subscriber);
    if (!set) {
      subsToObjs.set(subscriber, (set = new Set()));
    }
    set.add(map);
  };

  const trackRenderToSub = (subscriber: Subscriber, map: SubscriberMap) => {
    let host: QwikElement | undefined = undefined;
    if (isQwikElement(subscriber)) {
      host = subscriber;
    } else if (isSignalOperation(subscriber)) {
      host = subscriber[0]
    }
    if (host) {
      let set = hostToSub.get(host);
      if (!set) {
        hostToSub.set(host, (set = new Set()));
      }
      set.add(map);
    }
  };
  const getLocal = (obj: any, initialMap?: SubscriberMap) => {
    let local = tryGetLocal(obj);
    if (local) {
      assertEqual(
        initialMap,
        undefined,
        'subscription map can not be set to an existing object',
        local
      );
    } else {
      const map = !initialMap ? (new Map() as SubscriberMap) : initialMap;
      map.forEach((_, key) => {
        trackSubToObj(key, map);
      });
      objToSubs.set(
        obj,
        (local = {
          $subs$: map,
          $addSub$(subscriber: Subscriber, key?: string) {
            if (key == null) {
              map.set(subscriber, null);
            } else {
              let sub = map.get(subscriber);
              if (sub === undefined) {
                map.set(subscriber, (sub = new Set()));
              }
              if (sub) {
                sub.add(key);
              }
            }
            trackSubToObj(subscriber, map);
          },
          $notifySubs$(key?: string) {
            map.forEach((value, subscriber) => {
              if (value === null || !key || value.has(key)) {
                notifyChange(subscriber, containerState);
              }
            });
          },
        })
      );
      seal(local);
    }
    return local;
  };

  const manager = {
    $tryGetLocal$: tryGetLocal,
    $getLocal$: getLocal,
    $clearSub$: clearSub,
  };
  seal(manager);
  return manager;
};
