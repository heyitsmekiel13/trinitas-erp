<?php

namespace App\Observers;

use App\Models\Item;

/**
 * The barcode printed on a shelf label and the SKU it looks up are the same
 * code — there was never a second, independent number to assign. Left blank
 * on the form, the barcode is filled in here from the SKU, the same way a
 * document number is issued by the server rather than typed: one write path
 * (the generic resource endpoint, an import, a seeder, tinker) all get it
 * for free instead of four places needing to remember to set it.
 *
 * Only fills a blank. An item that already carries a different barcode —
 * printed and in circulation, or supplied by a vendor — is never
 * overwritten, including when its SKU later changes.
 */
class ItemObserver
{
    public function creating(Item $item): void
    {
        $this->fillFromSku($item);
    }

    public function updating(Item $item): void
    {
        $this->fillFromSku($item);
    }

    private function fillFromSku(Item $item): void
    {
        if (blank($item->barcode) && filled($item->sku)) {
            $item->barcode = $item->sku;
        }
    }
}
