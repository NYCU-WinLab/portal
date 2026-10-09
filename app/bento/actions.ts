"use server"

import { revalidatePath } from "next/cache"

import {
  addBentoOrderItem,
  closeBentoOrder,
  copyBentoOrder,
  createBentoOrder,
  deleteBentoOrder,
  removeBentoOrderItem,
  reopenBentoOrder,
} from "@/lib/actions/bento"
import {
  createBentoRestaurant,
  deleteBentoRestaurant,
  setBentoMenu,
  setBentoMenuImage,
  setBentoOptionGroups,
  updateBentoRestaurant,
} from "@/lib/actions/bento-restaurants"
import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

// The pages' writes: the same actions MCP runs, then a refresh of the bento
// pages. Input is parsed by the action, as for MCP.

type Result<T = unknown> = { error?: string; result?: T }

async function call<T>(action: Action, input: unknown): Promise<Result<T>> {
  const actor = await requireActor("/bento")
  let result: T
  try {
    result = (await runAction(action, actor, input)) as T
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/bento", "layout")
  return { result }
}

export const order = async (input: unknown) => call(addBentoOrderItem, input)
export const removeLine = async (lineId: string) =>
  call(removeBentoOrderItem, { lineId })
export const copyOrder = async (orderId: string, fromUserId: string) =>
  call<{ lines: number }>(copyBentoOrder, { orderId, fromUserId })
export const openOrder = async (input: unknown) =>
  call<{ id: string }>(createBentoOrder, input)
export const closeOrder = async (orderId: string) =>
  call(closeBentoOrder, { orderId })
export const reopenOrder = async (orderId: string) =>
  call(reopenBentoOrder, { orderId })
export const deleteOrder = async (orderId: string) =>
  call(deleteBentoOrder, { orderId })
export const addRestaurant = async (input: unknown) =>
  call(createBentoRestaurant, input)
export const updateRestaurant = async (input: unknown) =>
  call(updateBentoRestaurant, input)
export const deleteRestaurant = async (restaurantId: string) =>
  call(deleteBentoRestaurant, { restaurantId })
export const saveMenu = async (input: unknown) => call(setBentoMenu, input)
export const saveOptions = async (input: unknown) =>
  call(setBentoOptionGroups, input)
export const saveMenuImage = async (input: unknown) =>
  call(setBentoMenuImage, input)
