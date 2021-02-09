#!/bin/bash

# A simple script looking for undefined variables.
echo "Looking for undefined variables $1"
if grep "^[^\#].*= @.*@" $1
then
    echo "Undefined variables available in at least one configuration file"
    exit 1
else
    exit 0
fi
