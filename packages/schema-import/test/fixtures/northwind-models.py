import uuid

from django.db import models
from django.utils import timezone


class Category(models.Model):
    name = models.CharField(max_length=60, unique=True)
    description = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "categories"


class Supplier(models.Model):
    company_name = models.CharField(max_length=120)
    contact_email = models.EmailField(null=True, unique=True)

    class Meta:
        db_table = "suppliers"


class Product(models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("backorder", "Back-ordered"),
        ("discontinued", "Discontinued"),
    ]

    sku = models.CharField(max_length=24, unique=True)
    name = models.CharField(max_length=160)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(
        max_length=16,
        choices=[
            ("active", "Active"),
            ("backorder", "Back-ordered"),
            ("discontinued", "Discontinued"),
        ],
        default="active",
    )
    active = models.BooleanField(default=True, db_index=True)
    category = models.ForeignKey(
        "Category", on_delete=models.SET_NULL, null=True, blank=True
    )
    supplier = models.ForeignKey("Supplier", on_delete=models.PROTECT)
    tags = models.ManyToManyField("Tag")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products"
        unique_together = (("sku", "supplier"),)


class Tag(models.Model):
    label = models.CharField(max_length=40, unique=True)

    class Meta:
        db_table = "tags"


class Customer(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    full_name = models.CharField(max_length=120)
    email = models.EmailField(unique=True)
    profile = models.JSONField(null=True)

    class Meta:
        db_table = "customers"


class Order(models.Model):
    customer = models.ForeignKey("Customer", on_delete=models.CASCADE)
    ordered_at = models.DateTimeField(default=timezone.now)
    freight = models.DecimalField(max_digits=8, decimal_places=2, null=True)

    class Meta:
        db_table = "orders"
