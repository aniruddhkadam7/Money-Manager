import type { Category } from "@/lib/domain/types";
import { isPictureName, PictureIcon } from "./picture-icon";

/**
 * Category picture. Built-in categories have their own icon (by id, so Petrol shows a fuel pump even though
 * it was stored before that icon existed); your own categories use their chosen icon, or a tag.
 * `tile` is the large list size.
 */
export function CategoryIcon({
  category,
  tile = false,
  className,
}: {
  category: Pick<Category, "color" | "icon"> & { id?: string };
  tile?: boolean;
  className?: string;
}) {
  const id = category.id === "other-income" ? "income" : category.id;
  const name = isPictureName(id) ? id : isPictureName(category.icon) ? category.icon : "custom";
  return <PictureIcon name={name} color={category.color} tile={tile} className={className} />;
}
